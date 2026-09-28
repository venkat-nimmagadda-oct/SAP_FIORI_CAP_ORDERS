const cds = require('@sap/cds');
const LOG = cds.log('orders');

// Increase query timeout for tile queries
const TILE_QUERY_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Helper: Execute query with timeout
 */
async function queryWithTimeout(queryPromise, timeoutMs = TILE_QUERY_TIMEOUT_MS) {
    return Promise.race([
        queryPromise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

// ═══════════════════════════════════════════════
// BUSINESS CONSTANTS
// ═══════════════════════════════════════════════
const LOCK_EXPIRY_MINUTES = 5;
const EXCEL_EXPORT_MAX_DAYS = 30;
const DEFAULT_FILTER_DAYS = 15;
const MAX_EXPORT_RECORDS = 65000;

module.exports = cds.service.impl(async function () {

    // ═══════════════════════════════════════════════
    // SERVICE ENTITIES
    // Use these only for OData events/actions/hooks.
    // These belong to SupplierOrderService.*
    // ═══════════════════════════════════════════════
    const {
        SupplierOrdersReprocess: SrvSupplierOrdersReprocess,
        OrderHistory: SrvOrderHistory,
        AuditLog: SrvAuditLog,
        UserFilterVariants: SrvUserFilterVariants
    } = this.entities;

    // ═══════════════════════════════════════════════
    // DB / PERSISTENCE ENTITIES
    // Use these for actual SELECT / INSERT / UPDATE / DELETE.
    // These belong to namespace orders.portal.*
    // Physical table becomes orders_portal_*
    // ═══════════════════════════════════════════════
    const {
        SupplierOrdersReprocess: DbSupplierOrdersReprocess,
        OrderHistory: DbOrderHistory,
        AuditLog: DbAuditLog,
        UserFilterVariants: DbUserFilterVariants
    } = cds.entities('orders.portal');


    // ═══════════════════════════════════════════════
    // SECTION 1: RESEND ACTION
    // ═══════════════════════════════════════════════
    this.on('resend', SrvSupplierOrdersReprocess, async (req) => {
        const { ID } = req.params[0];
        const userId = req.user?.id || 'anonymous';
        const now = new Date();

        LOG.info(`Resend requested by ${userId} for ID: ${ID}`);

        const lockAcquired = await acquireLock(ID, userId, now);
        if (!lockAcquired) {
            return await handleBlocked(req, ID, userId, 'RESEND_BLOCKED');
        }

        const order = await SELECT.one.from(DbSupplierOrdersReprocess).where({ ID });
        if (!order) {
            await releaseLock(ID);
            return req.error(404, 'Order not found');
        }

        let payload;
        try {
            payload = JSON.parse(order.rawData);
        } catch (e) {
            await releaseLock(ID);
            return req.error(400, `Invalid rawData JSON: ${e.message}`);
        }

        try {
            LOG.info(`Calling CPI Reprocess API for PO: ${order.purchaseOrderNumber}`);

            // TODO: Real CPI call
            const cpiSuccess = true;

            if (cpiSuccess) {
                await archiveToHistory(order, 'PORTAL_RESEND', userId, now, 4, null);

                await INSERT.into(DbAuditLog).entries({
                    action: 'RESEND',
                    purchaseOrderNumber: order.purchaseOrderNumber,
                    poLineNumber: order.poLineNumber,
                    supplier: order.supplier,
                    salesOrg: order.salesOrg,
                    status: 'SUCCESS',
                    message: `Resent to CPI by ${userId}`,
                    performedBy: userId
                });

                await DELETE.from(DbSupplierOrdersReprocess).where({ ID });

                LOG.info(`Order ${order.purchaseOrderNumber} resent successfully`);

                return {
                    success: true,
                    message: `Order ${order.purchaseOrderNumber} resent successfully`
                };
            }

            await releaseLock(ID);

            return {
                success: false,
                message: `Order ${order.purchaseOrderNumber} was not resent`
            };

        } catch (error) {
            await releaseLock(ID);

            await INSERT.into(DbAuditLog).entries({
                action: 'RESEND',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'FAILED',
                message: `Resend failed: ${error.message}`,
                performedBy: userId
            });

            LOG.error('Resend failed:', error.message);

            return {
                success: false,
                message: `Resend failed: ${error.message}`
            };
        }
    });


    // ═══════════════════════════════════════════════
    // SECTION 2: CANCEL ACTION
    // ═══════════════════════════════════════════════
    this.on('cancel', SrvSupplierOrdersReprocess, async (req) => {
        const { ID } = req.params[0];
        const userId = req.user?.id || 'anonymous';
        const now = new Date();

        LOG.info(`Cancel requested by ${userId} for ID: ${ID}`);

        const lockAcquired = await acquireLock(ID, userId, now);
        if (!lockAcquired) {
            return await handleBlocked(req, ID, userId, 'CANCEL_BLOCKED');
        }

        const order = await SELECT.one.from(DbSupplierOrdersReprocess).where({ ID });
        if (!order) {
            await releaseLock(ID);
            return req.error(404, 'Order not found');
        }

        try {
            LOG.info(`Calling CPI Cancel API for PO: ${order.purchaseOrderNumber}`);

            // TODO: Real CPI cancel call

            await archiveToHistory(order, 'PORTAL_CANCEL', userId, now, 3, userId);

            await INSERT.into(DbAuditLog).entries({
                action: 'CANCEL',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'SUCCESS',
                message: `Cancelled by ${userId}`,
                performedBy: userId
            });

            await DELETE.from(DbSupplierOrdersReprocess).where({ ID });

            LOG.info(`Order ${order.purchaseOrderNumber} cancelled successfully`);

            return {
                success: true,
                message: `Order ${order.purchaseOrderNumber} cancelled successfully`
            };

        } catch (error) {
            await releaseLock(ID);

            await INSERT.into(DbAuditLog).entries({
                action: 'CANCEL',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'FAILED',
                message: `Cancel failed: ${error.message}`,
                performedBy: userId
            });

            LOG.error('Cancel failed:', error.message);

            return {
                success: false,
                message: `Cancel failed: ${error.message}`
            };
        }
    });


    // ═══════════════════════════════════════════════
    // SECTION 3: SALES-ORG-BASED FILTERING
    // Keep service entities here because these hooks apply to OData READ requests.
    // ═══════════════════════════════════════════════
    this.before('READ', SrvSupplierOrdersReprocess, (req) => applySalesOrgFilter(req));
    this.before('READ', SrvOrderHistory, (req) => applySalesOrgFilter(req));


    // ═══════════════════════════════════════════════
    // SECTION 4: EXCEL EXPORT 30-DAY VALIDATION
    // ═══════════════════════════════════════════════
    this.before('READ', SrvOrderHistory, async (req) => {
        const isExport =
            req.req?.headers?.['accept']?.includes('spreadsheet') ||
            req.req?.query?.['$format'] === 'xlsx';

        if (!isExport) return;

        const whereClause = req.query.SELECT?.where || [];
        const hasDateFilter = JSON.stringify(whereClause).includes('purchaseOrderDate');

        if (!hasDateFilter) {
            return req.reject(
                400,
                `Excel export requires a date range filter. ` +
                `Please select an Order Date range up to ${EXCEL_EXPORT_MAX_DAYS} days.`
            );
        }

        try {
            const result = await SELECT.one
                .from(DbOrderHistory)
                .columns('count(*) as total')
                .where(req.query.SELECT.where || []);

            if (result?.total > MAX_EXPORT_RECORDS) {
                return req.reject(
                    400,
                    `Export limited to ${MAX_EXPORT_RECORDS.toLocaleString()} records. ` +
                    `Current selection returns ${result.total.toLocaleString()} records. ` +
                    `Please narrow your date range.`
                );
            }
        } catch (e) {
            LOG.warn('Could not count export records:', e.message);
        }
    });


    // ═══════════════════════════════════════════════
    // SECTION 5: USER VARIANT OWNERSHIP
    // Hooks use service entity; database queries use DB entity.
    // ═══════════════════════════════════════════════
    this.before('READ', SrvUserFilterVariants, (req) => {
        const userId = req.user?.id;
        if (!userId) return;

        req.query.where(`userId = '${userId}'`);
    });

    this.before('CREATE', SrvUserFilterVariants, (req) => {
        const userId = req.user?.id || 'anonymous';
        req.data.userId = userId;
    });

    this.before('UPDATE', SrvUserFilterVariants, async (req) => {
        const userId = req.user?.id;

        const variant = await SELECT.one
            .from(DbUserFilterVariants)
            .where({ ID: req.data.ID });

        if (variant && variant.userId !== userId) {
            return req.reject(403, 'You can only modify your own filter variants');
        }
    });

    this.before('DELETE', SrvUserFilterVariants, async (req) => {
        const userId = req.user?.id;
        const ID = req.params?.[0]?.ID;

        const variant = await SELECT.one
            .from(DbUserFilterVariants)
            .where({ ID });

        if (variant && variant.userId !== userId) {
            return req.reject(403, 'You can only delete your own filter variants');
        }
    });


    // ═══════════════════════════════════════════════
    // SECTION 6: CPI INSERTION VALIDATION
    // Keep service entity because this validates incoming OData CREATE.
    // ═══════════════════════════════════════════════
    this.before('CREATE', SrvSupplierOrdersReprocess, async (req) => {
        const data = req.data;

        if (data.rawData) {
            try {
                JSON.parse(data.rawData);
            } catch (e) {
                return req.reject(400, `Invalid rawData JSON: ${e.message}`);
            }
        }

        if (!data.status) data.status = 2;
        if (!data.createdBy) data.createdBy = req.user?.id || 'CPI';
        if (!data.createdOn) data.createdOn = new Date();
        if (!data.reprocessCounter) data.reprocessCounter = 0;
        if (data.isProcessing === undefined) data.isProcessing = false;

        LOG.info(`CPI inserting failed order: PO ${data.purchaseOrderNumber}`);
    });


    // ═══════════════════════════════════════════════
    // SECTION 7: TILE COUNT HANDLER
    // Direct count queries must use DB entities, not service entities.
    // ═══════════════════════════════════════════════
    this.on('getTileCount', async (req) => {
        const { timeRange, tileType } = req.data;
        const userSalesOrg = req.user?.attr?.SalesOrg;
        const isAdmin = req.user?.is?.('Admin');

        const rangeMap = {
            '1hour': 1 * 60 * 60 * 1000,
            '24hours': 24 * 60 * 60 * 1000,
            '7days': 7 * 24 * 60 * 60 * 1000,
            '15days': 15 * 24 * 60 * 60 * 1000,
            '30days': 30 * 24 * 60 * 60 * 1000
        };

        const timeLabels = {
            '1hour': 'Past Hour',
            '24hours': 'Past 24 Hours',
            '7days': 'Past 7 Days',
            '15days': 'Past 15 Days',
            '30days': 'Past 30 Days'
        };

        LOG.info(
            `Tile query: type=${tileType}, range=${timeRange}, user=${req.user?.id}, salesOrg=${userSalesOrg}`
        );

        try {
            let query;

            switch (tileType) {
                case 'failed': {
                    query = SELECT.one
                        .from(DbSupplierOrdersReprocess)
                        .columns('count(*) as count');

                    if (!isAdmin && userSalesOrg) {
                        query = query.where({ salesOrg: userSalesOrg });
                    }

                    const result = await queryWithTimeout(query);
                    const count = Number(result?.count || 0);

                    let info = 'All Clear';
                    let infoState = 'Positive';

                    if (count > 0 && count < 10) {
                        info = 'Requires Attention';
                        infoState = 'Critical';
                    } else if (count >= 10) {
                        info = 'Urgent Action';
                        infoState = 'Negative';
                    }

                    return {
                        number: count,
                        numberUnit: 'orders',
                        info,
                        infoState,
                        title: 'Failed Orders',
                        subtitle: timeLabels[timeRange] || 'Past 24 Hours'
                    };
                }

                case 'processing': {
                    query = SELECT.one
                        .from(DbSupplierOrdersReprocess)
                        .columns('count(*) as count')
                        .where({ isProcessing: true });

                    if (!isAdmin && userSalesOrg) {
                        query = query.and({ salesOrg: userSalesOrg });
                    }

                    const result = await queryWithTimeout(query);
                    const count = Number(result?.count || 0);

                    return {
                        number: count,
                        numberUnit: 'orders',
                        info: count > 0 ? 'Being Processed' : 'Idle',
                        infoState: 'Neutral',
                        title: 'In Progress',
                        subtitle: 'Currently'
                    };
                }

                case 'history': {
                    query = SELECT.one
                        .from(DbOrderHistory)
                        .columns('count(*) as count');

                    if (!isAdmin && userSalesOrg) {
                        query = query.where({ salesOrg: userSalesOrg });
                    }

                    const result = await queryWithTimeout(query);
                    const count = Number(result?.count || 0);

                    return {
                        number: count,
                        numberUnit: 'orders',
                        info: 'Total History',
                        infoState: 'Positive',
                        title: 'All Orders',
                        subtitle: timeLabels[timeRange] || 'Past 30 Days'
                    };
                }

                case 'completed': {
                    query = SELECT.one
                        .from(DbOrderHistory)
                        .columns('count(*) as count')
                        .where({ status: 0 });

                    if (!isAdmin && userSalesOrg) {
                        query = query.and({ salesOrg: userSalesOrg });
                    }

                    const result = await queryWithTimeout(query);
                    const count = Number(result?.count || 0);

                    return {
                        number: count,
                        numberUnit: 'orders',
                        info: 'Successfully Processed',
                        infoState: 'Positive',
                        title: 'Completed',
                        subtitle: timeLabels[timeRange] || 'Past 30 Days'
                    };
                }

                case 'cancelled': {
                    query = SELECT.one
                        .from(DbOrderHistory)
                        .columns('count(*) as count')
                        .where({ status: 3 });

                    if (!isAdmin && userSalesOrg) {
                        query = query.and({ salesOrg: userSalesOrg });
                    }

                    const result = await queryWithTimeout(query);
                    const count = Number(result?.count || 0);

                    return {
                        number: count,
                        numberUnit: 'orders',
                        info: 'Cancelled',
                        infoState: 'Neutral',
                        title: 'Cancelled Orders',
                        subtitle: timeLabels[timeRange] || 'Past 30 Days'
                    };
                }

                default:
                    return req.error(
                        400,
                        `Unknown tileType: ${tileType}. Valid: failed, processing, history, completed, cancelled`
                    );
            }

        } catch (error) {
            LOG.error(`getTileCount failed [${tileType}/${timeRange}]:`, error.message);

            return {
                number: 0,
                numberUnit: 'orders',
                info: 'Loading...',
                infoState: 'Neutral',
                title: tileType ? tileType.charAt(0).toUpperCase() + tileType.slice(1) : 'Tile',
                subtitle: timeLabels[timeRange] || 'Past 24 Hours'
            };
        }
    });


    // ═══════════════════════════════════════════════
    // SECTION 8: HELPER FUNCTIONS
    // All DB operations here use DB entities.
    // ═══════════════════════════════════════════════

    async function acquireLock(ID, userId, now) {
        const lockExpiresAt = new Date(now.getTime() + LOCK_EXPIRY_MINUTES * 60 * 1000);

        const existing = await SELECT.one
            .from(DbSupplierOrdersReprocess)
            .where({ ID });

        if (!existing) return false;

        const isLocked =
            existing.isProcessing === true &&
            existing.lockExpiresAt &&
            new Date(existing.lockExpiresAt) > now;

        if (isLocked) return false;

        await UPDATE(DbSupplierOrdersReprocess)
            .where({ ID })
            .set({
                isProcessing: true,
                lockedBy: userId,
                lockedAt: now,
                lockExpiresAt
            });

        return true;
    }

    async function releaseLock(ID) {
        try {
            await UPDATE(DbSupplierOrdersReprocess)
                .where({ ID })
                .set({
                    isProcessing: false,
                    lockedBy: null,
                    lockedAt: null,
                    lockExpiresAt: null
                });
        } catch (err) {
            LOG.error(`Failed to release lock for ID ${ID}:`, err.message);
        }
    }

    async function handleBlocked(req, ID, userId, actionName) {
        const locked = await SELECT.one
            .from(DbSupplierOrdersReprocess)
            .columns('lockedBy', 'purchaseOrderNumber', 'salesOrg')
            .where({ ID });

        if (!locked) return req.error(404, 'Order not found');

        await INSERT.into(DbAuditLog).entries({
            action: actionName,
            purchaseOrderNumber: locked.purchaseOrderNumber || 'N/A',
            supplier: 'N/A',
            salesOrg: locked.salesOrg,
            status: 'BLOCKED',
            message: `Action blocked — order locked by ${locked.lockedBy || 'another user'}`,
            performedBy: userId
        });

        return req.error(
            409,
            `This order is currently being processed by ${locked.lockedBy || 'another user'}. ` +
            `Please refresh and try again.`
        );
    }

    async function archiveToHistory(order, sourceTable, userId, now, status, cancelledBy) {
        const entry = {
            ID: order.ID,
            purchaseOrderNumber: order.purchaseOrderNumber,
            poLineNumber: order.poLineNumber,
            salesOrderNumber: order.salesOrderNumber,
            supplier: order.supplier,
            supplierName: order.supplierName,
            country: order.country,
            salesOrg: order.salesOrg,
            companyCode: order.companyCode,
            plant: order.plant,
            octMaterialNumber: order.octMaterialNumber,
            vendorMaterialNumber: order.vendorMaterialNumber,
            status,
            purchaseOrderDate: order.purchaseOrderDate,
            sourceTable,
            createdBy: userId,
            createdOn: now
        };

        if (cancelledBy) {
            entry.cancelledBy = cancelledBy;
            entry.cancelledAt = now;
        } else {
            entry.processedBy = userId;
            entry.processedAt = now;
        }

        await INSERT.into(DbOrderHistory).entries(entry);
    }

    function applySalesOrgFilter(req) {
        const userSalesOrg = req.user?.attr?.SalesOrg;
        const isAdmin = req.user?.is?.('Admin');

        if (isAdmin) return;

        if (userSalesOrg) {
            req.query.where(`salesOrg = '${userSalesOrg}'`);
            LOG.info(`Filtering by SalesOrg=${userSalesOrg} for user ${req.user?.id}`);
        }
    }


    // ═══════════════════════════════════════════════
    // SECTION 9: AUTO-CLEANUP EXPIRED LOCKS
    // Disabled for now. If enabled later, use DbSupplierOrdersReprocess.
    // ═══════════════════════════════════════════════

    /*
    setInterval(async () => {
        try {
            const result = await UPDATE(DbSupplierOrdersReprocess)
                .where({
                    isProcessing: true,
                    lockExpiresAt: { '<': new Date() }
                })
                .set({
                    isProcessing: false,
                    lockedBy: null,
                    lockedAt: null,
                    lockExpiresAt: null
                });

            if (result > 0) {
                LOG.info(`Auto-released ${result} expired lock(s)`);
            }
        } catch (err) {
            LOG.error('Lock cleanup failed:', err.message);
        }
    }, 60000);
    */

});