const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

const LOG = cds.log('orders');
const TILE_QUERY_TIMEOUT_MS = 15000;
const LOCK_EXPIRY_MINUTES = Number(
    process.env.RESEND_LOCK_EXPIRY_MINUTES || 11
);
const EXCEL_EXPORT_MAX_DAYS = 30;
const MAX_EXPORT_RECORDS = 65000;

const CPI_RESEND_DESTINATION =
    process.env.CPI_RESEND_DESTINATION || 'Portal_IS_DEV';

const CPI_RESEND_PATH =
    process.env.CPI_RESEND_PATH ||
    '/http/IF_Portal_JMS_PurchaseOrderCreate_Resend';

const CPI_RESEND_TIMEOUT_MS = Number(
    process.env.CPI_RESEND_TIMEOUT_MS || 30000
);

const CPI_RESEND_PAYLOAD_MODE =
    process.env.CPI_RESEND_PAYLOAD_MODE || 'raw';

const PORTAL_SOURCE_SYSTEM =
    process.env.PORTAL_SOURCE_SYSTEM || 'ORDER_PORTAL';

const FAILED_ORDER_STATUSES = [1, 2];

async function queryWithTimeout(
    queryPromise,
    timeoutMs = TILE_QUERY_TIMEOUT_MS
) {
    return Promise.race([
        queryPromise,
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`Query timeout after ${timeoutMs}ms`)),
                timeoutMs
            )
        )
    ]);
}

module.exports = cds.service.impl(async function () {
    const {
        SupplierOrdersReprocess,
        OrderHistory,
        AuditLog,
        UserFilterVariants
    } = this.entities;

    // ==================================================
    // 1. RESEND ACTION
    // ==================================================
    this.on('resend', SupplierOrdersReprocess, async (req) => {
        const { supplierReferenceNumber } = req.params[0] || {};
        const userId = req.user?.id || 'anonymous';
        const requestTime = new Date();

        if (!supplierReferenceNumber) {
            return req.reject(
                400,
                'Supplier Reference Number is required'
            );
        }

        LOG.info(
            `[RESEND] requestedBy=${userId}, ` +
            `supplierReferenceNumber=${supplierReferenceNumber}`
        );

        const order = await SELECT.one
            .from(SupplierOrdersReprocess)
            .where({ supplierReferenceNumber });

        if (!order) {
            return req.reject(404, 'Order not found');
        }

        validateOrderSalesOrgAccess(req, order, 'RESEND');

        const lockAcquired = await acquireLock(
            supplierReferenceNumber,
            userId,
            requestTime
        );

        if (!lockAcquired) {
            return handleBlocked(
                req,
                supplierReferenceNumber,
                userId,
                'RESEND_BLOCKED'
            );
        }

        let payload;

        try {
            payload = JSON.parse(order.rawData);
        } catch (error) {
            await releaseLock(supplierReferenceNumber);

            return req.reject(
                400,
                `Invalid rawData JSON: ${error.message}`
            );
        }

        // One business-user click equals exactly one portal Resend attempt.
        const portalResendCount =
            Number(order.reprocessCounter || 0) + 1;

        const portalResendAt = new Date();

        try {
            await UPDATE(SupplierOrdersReprocess)
                .where({ supplierReferenceNumber })
                .set({
                    reprocessCounter: portalResendCount,
                    lastRetryDate: portalResendAt,
                    changedBy: userId,
                    changedOn: portalResendAt
                });

            order.reprocessCounter = portalResendCount;
            order.lastRetryDate = portalResendAt;
            order.changedBy = userId;
            order.changedOn = portalResendAt;

            LOG.info(
                `[PORTAL_RESEND_ATTEMPT] ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `portalResendCount=${portalResendCount}, ` +
                `portalResendBy=${userId}, ` +
                `portalResendAt=${portalResendAt.toISOString()}`
            );

            const cpiResponse = await callCpiResend(
                order,
                payload,
                userId,
                portalResendAt,
                portalResendCount
            );

            LOG.info(
                `[RESEND] CPI accepted request, ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `po=${order.purchaseOrderNumber}, ` +
                `httpStatus=${cpiResponse.status}, ` +
                `portalResendCount=${cpiResponse.portalResendCount}, ` +
                `portalResendBy=${cpiResponse.portalResendBy}, ` +
                `sourceSystem=${cpiResponse.sourceSystem}, ` +
                `correlationId=${cpiResponse.correlationId}`
            );

            // HTTP 202 means CPI accepted the asynchronous request.
            // CPI owns the final completed or failed status.
            await INSERT.into(AuditLog).entries({
                ID: cds.utils.uuid(),
                action: 'RESEND',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'SUCCESS',
                message:
                    `Submitted to CPI by ${userId}; ` +
                    `supplierReferenceNumber=${supplierReferenceNumber}; ` +
                    `portalResendCount=${cpiResponse.portalResendCount}; ` +
                    `CPI HTTP status ${cpiResponse.status}; ` +
                    `sourceSystem=${cpiResponse.sourceSystem}; ` +
                    `correlationId=${cpiResponse.correlationId}`,
                performedBy: userId
            });

            // Keep the row so asynchronous CPI processing can update it.
            // Release only the portal-owned lock.
            const unlockedRows = await UPDATE(SupplierOrdersReprocess)
                .where({
                    supplierReferenceNumber,
                    isProcessing: true,
                    lockedBy: userId
                })
                .set({
                    isProcessing: false,
                    lockedBy: null,
                    lockedAt: null,
                    lockExpiresAt: null
                });

            LOG.info(
                `[RESEND] CPI submission completed and portal lock released, ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `portalResendCount=${portalResendCount}, ` +
                `unlockedRows=${unlockedRows}, ` +
                `correlationId=${cpiResponse.correlationId}`
            );

            return {
                success: true,
                message:
                    `Order ${order.purchaseOrderNumber}/` +
                    `${order.poLineNumber} submitted to CPI successfully`
            };
        } catch (error) {
            const errorMessage = normalizeErrorMessage(error);

            // The click was already counted once. Do not increment again.
            await UPDATE(SupplierOrdersReprocess)
                .where({ supplierReferenceNumber })
                .set({
                    isProcessing: false,
                    lockedBy: null,
                    lockedAt: null,
                    lockExpiresAt: null,
                    customErrorText: errorMessage.substring(0, 1000)
                });

            await INSERT.into(AuditLog).entries({
                ID: cds.utils.uuid(),
                action: 'RESEND',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'FAILED',
                message:
                    `Portal Resend submission failed: ${errorMessage}; ` +
                    `supplierReferenceNumber=${supplierReferenceNumber}; ` +
                    `portalResendCount=${portalResendCount}; ` +
                    `portalResendBy=${userId}; ` +
                    `sourceSystem=${PORTAL_SOURCE_SYSTEM}`,
                performedBy: userId
            });

            LOG.error(
                `[RESEND] failed, ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `po=${order.purchaseOrderNumber}, ` +
                `portalResendCount=${portalResendCount}, ` +
                `error=${errorMessage}`
            );

            return {
                success: false,
                message: `Resend submission failed: ${errorMessage}`
            };
        }
    });

    // ==================================================
    // 2. CANCEL ACTION
    // ==================================================
    this.on('cancel', SupplierOrdersReprocess, async (req) => {
        const { supplierReferenceNumber } = req.params[0] || {};
        const userId = req.user?.id || 'anonymous';
        const now = new Date();

        if (!supplierReferenceNumber) {
            return req.reject(
                400,
                'Supplier Reference Number is required'
            );
        }

        LOG.info(
            `[CANCEL] requestedBy=${userId}, ` +
            `supplierReferenceNumber=${supplierReferenceNumber}`
        );

        const order = await SELECT.one
            .from(SupplierOrdersReprocess)
            .where({ supplierReferenceNumber });

        if (!order) {
            return req.reject(404, 'Order not found');
        }

        validateOrderSalesOrgAccess(req, order, 'CANCEL');

        const lockAcquired = await acquireLock(
            supplierReferenceNumber,
            userId,
            now
        );

        if (!lockAcquired) {
            return handleBlocked(
                req,
                supplierReferenceNumber,
                userId,
                'CANCEL_BLOCKED'
            );
        }

        try {
            // OrderHistory uses its own database-generated ID.
            // Do not copy the SupplierOrdersReprocess technical ID.
            await archiveToHistory(
                order,
                'PORTAL_CANCEL',
                userId,
                now,
                3,
                userId
            );

            await INSERT.into(AuditLog).entries({
                ID: cds.utils.uuid(),
                action: 'CANCEL',
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                supplier: order.supplier,
                salesOrg: order.salesOrg,
                status: 'SUCCESS',
                message:
                    `Cancelled by ${userId}; ` +
                    `supplierReferenceNumber=${supplierReferenceNumber}`,
                performedBy: userId
            });

            const deletedRows = await DELETE
                .from(SupplierOrdersReprocess)
                .where({ supplierReferenceNumber });

            if (!deletedRows) {
                throw Object.assign(
                    new Error(
                        'Failed Orders record was not deleted after cancellation'
                    ),
                    { code: 'CANCEL_DELETE_FAILED' }
                );
            }

            LOG.info(
                `[CANCEL] completed successfully, ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `po=${order.purchaseOrderNumber}, ` +
                `line=${order.poLineNumber}, ` +
                `cancelledBy=${userId}`
            );

            return {
                success: true,
                message:
                    `Order ${order.purchaseOrderNumber}/` +
                    `${order.poLineNumber} cancelled successfully`
            };
        } catch (error) {
            LOG.error('[CANCEL] failed', {
                supplierReferenceNumber,
                sourceTechnicalId: order.id,
                purchaseOrderNumber: order.purchaseOrderNumber,
                poLineNumber: order.poLineNumber,
                message: error.message,
                code: error.code,
                detail: error.detail,
                table: error.table,
                column: error.column,
                constraint: error.constraint,
                stack: error.stack
            });

            /*
             * Do not run releaseLock() or another database INSERT here.
             *
             * A PostgreSQL error may already have aborted the request
             * transaction. CAP will roll back this request, including the
             * previously acquired lock, when req.reject() throws.
             */

            if (error.code === '23502') {
                return req.reject(
                    422,
                    `Order ${order.purchaseOrderNumber}/` +
                    `${order.poLineNumber} could not be cancelled because ` +
                    `required order information is missing. ` +
                    `The order remains in Failed Orders.`
                );
            }

            if (error.code === '23505') {
                return req.reject(
                    409,
                    `Order ${order.purchaseOrderNumber}/` +
                    `${order.poLineNumber} could not be cancelled because ` +
                    `a conflicting history record exists. ` +
                    `The order remains in Failed Orders.`
                );
            }

            if (error.code === 'CANCEL_DELETE_FAILED') {
                return req.reject(
                    409,
                    `Order ${order.purchaseOrderNumber}/` +
                    `${order.poLineNumber} could not be removed from ` +
                    `Failed Orders. Refresh the page and retry.`
                );
            }

            return req.reject(
                500,
                `Order ${order.purchaseOrderNumber}/` +
                `${order.poLineNumber} could not be cancelled. ` +
                `The order remains in Failed Orders. ` +
                `Please retry or contact support.`
            );
        }
    });

    // ==================================================
    // 3. READ AUTHORIZATION AND FAILED-QUEUE FILTERS
    // ==================================================
    this.before('READ', SupplierOrdersReprocess, (req) => {
        addFailedOrderStatusFilter(req.query);
        applySalesOrgFilter(req);
    });

    this.before('READ', OrderHistory, applySalesOrgFilter);

    // ==================================================
    // 4. EXCEL EXPORT VALIDATION
    // ==================================================
    this.before('READ', OrderHistory, async (req) => {
        const isExport =
            req.req?.headers?.accept?.includes('spreadsheet') ||
            req.req?.query?.$format === 'xlsx';

        if (!isExport) {
            return;
        }

        const whereClause = req.query.SELECT?.where || [];

        const hasDateFilter =
            JSON.stringify(whereClause).includes('purchaseOrderDate');

        if (!hasDateFilter) {
            return req.reject(
                400,
                `Excel export requires an Order Date range up to ` +
                `${EXCEL_EXPORT_MAX_DAYS} days.`
            );
        }

        try {
            const result = await SELECT.one
                .from(OrderHistory)
                .columns('count(*) as total')
                .where(whereClause);

            if (result?.total > MAX_EXPORT_RECORDS) {
                return req.reject(
                    400,
                    `Export limited to ` +
                    `${MAX_EXPORT_RECORDS.toLocaleString()} records. ` +
                    `Current selection returns ` +
                    `${result.total.toLocaleString()} records.`
                );
            }
        } catch (error) {
            LOG.warn(
                `Could not count export records: ${error.message}`
            );
        }
    });

    // ==================================================
    // 5. USER FILTER VARIANTS
    // ==================================================
    this.before('READ', UserFilterVariants, (req) => {
        const userId = req.user?.id;

        if (userId) {
            req.query.where({ userId });
        }
    });

    this.before('CREATE', UserFilterVariants, (req) => {
        req.data.userId = req.user?.id || 'anonymous';
    });

    this.before('UPDATE', UserFilterVariants, async (req) => {
        const ID = req.data.ID || req.params?.[0]?.ID;

        const variant = await SELECT.one
            .from(UserFilterVariants)
            .where({ ID });

        if (variant && variant.userId !== req.user?.id) {
            return req.reject(
                403,
                'You can only modify your own filter variants'
            );
        }
    });

    this.before('DELETE', UserFilterVariants, async (req) => {
        const ID = req.params?.[0]?.ID;

        const variant = await SELECT.one
            .from(UserFilterVariants)
            .where({ ID });

        if (variant && variant.userId !== req.user?.id) {
            return req.reject(
                403,
                'You can only delete your own filter variants'
            );
        }
    });

    // ==================================================
    // 6. CPI INSERT VALIDATION
    // ==================================================
    this.before('CREATE', SupplierOrdersReprocess, (req) => {
        const data = req.data;

        if (!data.supplierReferenceNumber) {
            return req.reject(
                400,
                'supplierReferenceNumber is required when inserting ' +
                'through CAP OData'
            );
        }

        if (data.rawData) {
            try {
                JSON.parse(data.rawData);
            } catch (error) {
                return req.reject(
                    400,
                    `Invalid rawData JSON: ${error.message}`
                );
            }
        }

        if (data.status === undefined || data.status === null) {
            data.status = 1;
        }

        if (!data.createdBy) {
            data.createdBy = req.user?.id || 'CPI';
        }

        if (!data.createdOn) {
            data.createdOn = new Date();
        }

        if (
            data.reprocessCounter === undefined ||
            data.reprocessCounter === null
        ) {
            data.reprocessCounter = 0;
        }

        if (data.isProcessing === undefined) {
            data.isProcessing = false;
        }

        // SupplierOrdersReprocess.id is generated by PostgreSQL.
        delete data.id;

        LOG.info(
            `[CPI_INSERT] ` +
            `supplierReferenceNumber=${data.supplierReferenceNumber}, ` +
            `status=${data.status}, ` +
            `portalResendCount=${data.reprocessCounter}, ` +
            `po=${data.purchaseOrderNumber}`
        );
    });

    // ==================================================
    // 7. TILE COUNTS
    // ==================================================
    this.on('getTileCount', async (req) => {
        const { timeRange, tileType } = req.data;

        const timeLabels = {
            '1hour': 'Past Hour',
            '24hours': 'Past 24 Hours',
            '7days': 'Past 7 Days',
            '15days': 'Past 15 Days',
            '30days': 'Past 30 Days'
        };

        try {
            const validTileTypes = [
                'failed',
                'processing',
                'history',
                'completed',
                'cancelled'
            ];

            if (!validTileTypes.includes(tileType)) {
                return req.reject(
                    400,
                    `Unknown tileType: ${tileType}`
                );
            }

            const source =
                tileType === 'failed' || tileType === 'processing'
                    ? SupplierOrdersReprocess
                    : OrderHistory;

            let query = SELECT.one
                .from(source)
                .columns('count(*) as count');

            if (tileType === 'failed') {
                query = addFailedOrderStatusFilter(query);
            }

            if (tileType === 'processing') {
                query = query.where({ isProcessing: true });
                query = addFailedOrderStatusFilter(query);
            }

            if (tileType === 'completed') {
                query = query.where({ status: 0 });
            }

            if (tileType === 'cancelled') {
                query = query.where({ status: 3 });
            }

            query = applySalesOrgFilterToQuery(req, query);

            const result = await queryWithTimeout(query);
            const count = Number(result?.count || 0);

            if (tileType === 'failed') {
                return {
                    number: count,
                    numberUnit: 'orders',
                    info:
                        count === 0
                            ? 'All Clear'
                            : count < 10
                                ? 'Requires Attention'
                                : 'Urgent Action',
                    infoState:
                        count === 0
                            ? 'Positive'
                            : count < 10
                                ? 'Critical'
                                : 'Negative',
                    title: 'Failed Orders',
                    subtitle: timeLabels[timeRange] || 'Past 24 Hours'
                };
            }

            const labels = {
                processing: [
                    count > 0 ? 'Being Processed' : 'Idle',
                    'Neutral',
                    'In Progress',
                    'Currently'
                ],
                history: [
                    'Total History',
                    'Positive',
                    'All Orders',
                    timeLabels[timeRange] || 'Past 30 Days'
                ],
                completed: [
                    'Successfully Processed',
                    'Positive',
                    'Completed',
                    timeLabels[timeRange] || 'Past 30 Days'
                ],
                cancelled: [
                    'Cancelled',
                    'Neutral',
                    'Cancelled Orders',
                    timeLabels[timeRange] || 'Past 30 Days'
                ]
            };

            const [info, infoState, title, subtitle] =
                labels[tileType];

            return {
                number: count,
                numberUnit: 'orders',
                info,
                infoState,
                title,
                subtitle
            };
        } catch (error) {
            LOG.error(
                `[TILE] type=${tileType}, error=${error.message}`
            );

            return {
                number: 0,
                numberUnit: 'orders',
                info: 'Loading...',
                infoState: 'Neutral',
                title: String(tileType || 'Tile'),
                subtitle: timeLabels[timeRange] || 'Past 24 Hours'
            };
        }
    });

    // ==================================================
    // 8. HELPERS
    // ==================================================
    function addFailedOrderStatusFilter(query) {
        return query.where([
            { ref: ['status'] },
            'in',
            {
                list: FAILED_ORDER_STATUSES.map(
                    (status) => ({ val: status })
                )
            }
        ]);
    }

    function normalizeSalesOrgs(req) {
        const raw = req.user?.attr?.SalesOrg;

        return (Array.isArray(raw) ? raw : raw ? [raw] : [])
            .map((value) => String(value).trim())
            .filter(Boolean);
    }

    function applySalesOrgFilter(req) {
        const userId = req.user?.id || 'unknown';
        const isAdmin = req.user?.is?.('Admin') === true;
        const isViewer = req.user?.is?.('Viewer') === true;
        const salesOrgs = normalizeSalesOrgs(req);

        LOG.info(
            `[AUTH_CONTEXT] user=${userId}, ` +
            `isViewer=${isViewer}, ` +
            `isAdmin=${isAdmin}, ` +
            `salesOrgs=${JSON.stringify(salesOrgs)}, ` +
            `entity=${req.target?.name || 'unknown'}`
        );

        if (isAdmin) {
            LOG.info(
                `[READ_FILTER] Admin bypass applied, ` +
                `user=${userId}, ` +
                `uiWhere=${JSON.stringify(
                    req.query.SELECT?.where || []
                )}`
            );

            return;
        }

        if (!isViewer) {
            return req.reject(
                403,
                'Viewer authorization is not assigned'
            );
        }

        if (!salesOrgs.length) {
            return req.reject(
                403,
                'No Sales Organization authorization is assigned'
            );
        }

        if (salesOrgs.length === 1) {
            req.query.where({ salesOrg: salesOrgs[0] });
        } else {
            req.query.where([
                { ref: ['salesOrg'] },
                'in',
                {
                    list: salesOrgs.map(
                        (value) => ({ val: value })
                    )
                }
            ]);
        }

        LOG.info(
            `[READ_FILTER] user=${userId}, ` +
            `salesOrgs=${JSON.stringify(salesOrgs)}, ` +
            `finalWhere=${JSON.stringify(
                req.query.SELECT?.where || []
            )}`
        );
    }

    function applySalesOrgFilterToQuery(req, query) {
        if (req.user?.is?.('Admin') === true) {
            return query;
        }

        const salesOrgs = normalizeSalesOrgs(req);

        if (!salesOrgs.length) {
            req.reject(
                403,
                'No Sales Organization authorization is assigned'
            );
        }

        return salesOrgs.length === 1
            ? query.where({ salesOrg: salesOrgs[0] })
            : query.where([
                { ref: ['salesOrg'] },
                'in',
                {
                    list: salesOrgs.map(
                        (value) => ({ val: value })
                    )
                }
            ]);
    }

    function validateOrderSalesOrgAccess(req, order, action) {
        if (req.user?.is?.('Admin') === true) {
            return;
        }

        const salesOrgs = normalizeSalesOrgs(req);
        const orderSalesOrg = String(order.salesOrg || '').trim();

        if (!salesOrgs.includes(orderSalesOrg)) {
            LOG.warn(
                `[${action}_AUTH] rejected ` +
                `user=${req.user?.id}, ` +
                `orderSalesOrg=${orderSalesOrg}, ` +
                `allowed=${JSON.stringify(salesOrgs)}`
            );

            return req.reject(
                403,
                `Not authorized for Sales Org ${orderSalesOrg}`
            );
        }
    }

    function buildCpiPayload(
        order,
        originalPayload,
        userId,
        portalResendAt
    ) {
        if (CPI_RESEND_PAYLOAD_MODE !== 'wrapped') {
            return originalPayload;
        }

        return {
            action: 'RESEND',
            source: 'orders-portal',
            supplierReferenceNumber:
                order.supplierReferenceNumber,
            technicalId: order.id,
            purchaseOrderNumber: order.purchaseOrderNumber,
            poLineNumber: order.poLineNumber,
            supplier: order.supplier,
            salesOrg: order.salesOrg,
            requestedBy: userId,
            requestedAt: portalResendAt.toISOString(),
            portalResendCount: order.reprocessCounter,
            payload: originalPayload
        };
    }

    async function callCpiResend(
        order,
        originalPayload,
        userId,
        portalResendAt,
        portalResendCount
    ) {
        const requestPayload = buildCpiPayload(
            order,
            originalPayload,
            userId,
            portalResendAt
        );

        const correlationId =
            `${PORTAL_SOURCE_SYSTEM}-` +
            `${order.supplierReferenceNumber}-` +
            `${Date.now()}`;

        LOG.info(
            `[CPI_RESEND] ` +
            `destination=${CPI_RESEND_DESTINATION}, ` +
            `supplierReferenceNumber=${order.supplierReferenceNumber}, ` +
            `portalResendCount=${portalResendCount}, ` +
            `portalResendBy=${userId}, ` +
            `portalResendAt=${portalResendAt.toISOString()}, ` +
            `sourceSystem=${PORTAL_SOURCE_SYSTEM}, ` +
            `correlationId=${correlationId}`
        );

        try {
            const response = await executeHttpRequest(
                {
                    destinationName: CPI_RESEND_DESTINATION
                },
                {
                    method: 'POST',
                    url: CPI_RESEND_PATH,
                    data: requestPayload,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'X-Source-System':
                            String(PORTAL_SOURCE_SYSTEM),
                        'X-Portal-Resend-Count':
                            String(portalResendCount),
                        'X-Portal-Resend-By':
                            String(userId),
                        'X-Portal-Resend-At':
                            portalResendAt.toISOString(),
                        'X-Correlation-ID':
                            String(correlationId),
                        'X-Supplier-Reference-Number':
                            String(order.supplierReferenceNumber),
                        'X-Portal-Technical-ID':
                            String(order.id || ''),
                        'X-PO-Number':
                            String(order.purchaseOrderNumber || '')
                    },
                    timeout: CPI_RESEND_TIMEOUT_MS
                },
                {
                    fetchCsrfToken: false
                }
            );

            return {
                status: response.status,
                data: response.data,
                portalResendCount,
                portalResendBy: userId,
                portalResendAt,
                sourceSystem: PORTAL_SOURCE_SYSTEM,
                correlationId
            };
        } catch (error) {
            throw new Error(normalizeErrorMessage(error));
        }
    }

    function normalizeErrorMessage(error) {
        if (!error) {
            return 'Unknown error';
        }

        if (error.response) {
            const data =
                typeof error.response.data === 'string'
                    ? error.response.data
                    : JSON.stringify(error.response.data);

            return `CPI HTTP ${error.response.status}: ${data}`;
        }

        if (error.code === 'ECONNABORTED') {
            return (
                `CPI request timed out after ` +
                `${CPI_RESEND_TIMEOUT_MS}ms`
            );
        }

        return error.message || String(error);
    }

    async function acquireLock(
        supplierReferenceNumber,
        userId,
        now
    ) {
        const lockExpiresAt = new Date(
            now.getTime() +
            LOCK_EXPIRY_MINUTES * 60 * 1000
        );

        const updatedRows = await UPDATE(SupplierOrdersReprocess)
            .where({ supplierReferenceNumber })
            .and`(
                isProcessing = false or
                isProcessing is null or
                lockExpiresAt is null or
                lockExpiresAt <= ${now}
            )`
            .set({
                isProcessing: true,
                lockedBy: userId,
                lockedAt: now,
                lockExpiresAt
            });

        return Number(updatedRows) > 0;
    }

    async function releaseLock(supplierReferenceNumber) {
        try {
            await UPDATE(SupplierOrdersReprocess)
                .where({ supplierReferenceNumber })
                .set({
                    isProcessing: false,
                    lockedBy: null,
                    lockedAt: null,
                    lockExpiresAt: null
                });
        } catch (error) {
            LOG.error(
                `[LOCK] release failed ` +
                `supplierReferenceNumber=${supplierReferenceNumber}, ` +
                `error=${error.message}`
            );
        }
    }

    async function handleBlocked(
        req,
        supplierReferenceNumber,
        userId,
        actionName
    ) {
        const locked = await SELECT.one
            .from(SupplierOrdersReprocess)
            .columns(
                'supplierReferenceNumber',
                'lockedBy',
                'purchaseOrderNumber',
                'poLineNumber',
                'supplier',
                'salesOrg'
            )
            .where({ supplierReferenceNumber });

        if (!locked) {
            return req.reject(404, 'Order not found');
        }

        await INSERT.into(AuditLog).entries({
            ID: cds.utils.uuid(),
            action: actionName,
            purchaseOrderNumber:
                locked.purchaseOrderNumber || 'N/A',
            poLineNumber: locked.poLineNumber || 'N/A',
            supplier: locked.supplier || 'N/A',
            salesOrg: locked.salesOrg,
            status: 'BLOCKED',
            message:
                `Action blocked; locked by ` +
                `${locked.lockedBy || 'another user'}`,
            performedBy: userId
        });

        return req.reject(
            409,
            `This order is being processed by ` +
            `${locked.lockedBy || 'another user'}`
        );
    }

    async function archiveToHistory(
        order,
        sourceTable,
        userId,
        now,
        status,
        cancelledBy
    ) {
        /*
         * Do not provide ID here.
         *
         * PostgreSQL generates OrderHistory.id using:
         * orders_portal_orderhistory_id_seq.
         *
         * SupplierOrdersReprocess.id and OrderHistory.id are independent
         * technical identifiers.
         */
        const entry = {
            purchaseOrderNumber: order.purchaseOrderNumber,
            poLineNumber: order.poLineNumber,
            salesOrderNumber: order.salesOrderNumber,
            supplier: order.supplier,
            supplierName: order.supplierName,
            country: order.country,
            salesOrg: order.salesOrg,
            octMaterialNumber: order.octMaterialNumber,
            vendorMaterialNumber: order.vendorMaterialNumber,
            status,
            errorText: order.errorText,
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

        const insertResult = await INSERT
            .into(OrderHistory)
            .entries(entry);

        LOG.info(
            `[HISTORY] archived, ` +
            `sourceTable=${sourceTable}, ` +
            `sourceTechnicalId=${order.id}, ` +
            `supplierReferenceNumber=${order.supplierReferenceNumber}, ` +
            `po=${order.purchaseOrderNumber}, ` +
            `line=${order.poLineNumber}, ` +
            `status=${status}, ` +
            `affectedRows=${Number(insertResult)}`
        );

        return insertResult;
    }
});