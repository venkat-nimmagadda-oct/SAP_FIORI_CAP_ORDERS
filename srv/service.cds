using {orders.portal as db} from '../db/data-model';

@path: 'supplier-order'
service SupplierOrderService @(requires: 'authenticated-user') {

    @cds.search: {
        supplierReferenceNumber,
        purchaseOrderNumber,
        poLineNumber,
        salesOrderNumber,
        supplier,
        supplierName,
        country,
        salesOrg,
        octMaterialNumber,
        vendorMaterialNumber,
        errorText,
        customErrorText,
        changedBy
    }
    @restrict  : [
        {
            grant: 'READ',
            to   : 'Viewer'
        },
        {
            grant: 'READ',
            to   : 'Admin'
        },
        {
            grant: 'CREATE',
            to   : 'CPIInserter'
        },
        {
            grant: [
                'UPDATE',
                'DELETE'
            ],
            to   : 'Admin'
        },
        {
            grant: [
                'resend',
                'cancel'
            ],
            to   : [
                'Viewer',
                'Admin'
            ]
        }
    ]
    entity SupplierOrdersReprocess as projection on db.SupplierOrdersReprocess
        actions {
            action resend() returns ActionResult;
            action cancel() returns ActionResult;
        };


    @readonly
    @cds.search: {
        purchaseOrderNumber,
        poLineNumber,
        salesOrderNumber,
        supplier,
        supplierName,
        country,
        salesOrg,
        octMaterialNumber,
        vendorMaterialNumber,
        processedBy,
        cancelledBy
    }
    @restrict  : [
        {
            grant: 'READ',
            to   : 'Viewer'
        },
        {
            grant: 'READ',
            to   : 'Admin'
        }
    ]
    entity OrderHistory            as projection on db.OrderHistory;


    @restrict: [{
        grant: '*',
        to   : 'authenticated-user'
    }]
    entity UserFilterVariants      as projection on db.UserFilterVariants;


    @readonly
    @cds.search: {
        action,
        purchaseOrderNumber,
        supplier,
        performedBy,
        salesOrg,
        message
    }
    @restrict  : [{
        grant: 'READ',
        to   : 'Admin'
    }]
    entity AuditLog                as projection on db.AuditLog;


    @readonly
    entity StatusCodes             as projection on db.StatusCodes;


    function getTileCount(timeRange: String,
                          tileType: String) returns TileCountData;


    type TileCountData {
        number     : Integer;
        numberUnit : String;
        info       : String;
        infoState  : String;
        title      : String;
        subtitle   : String;
    };


    type ActionResult {
        success : Boolean;
        message : String;
    };
}


annotate SupplierOrderService.SupplierOrdersReprocess : status with @(Common.ValueList: {
    CollectionPath: 'StatusCodes',
    Parameters    : [
        {
            $Type            : 'Common.ValueListParameterInOut',
            LocalDataProperty: status,
            ValueListProperty: 'code'
        },
        {
            $Type            : 'Common.ValueListParameterDisplayOnly',
            ValueListProperty: 'text'
        }
    ]
});


annotate SupplierOrderService.OrderHistory : status with @(Common.ValueList: {
    CollectionPath: 'StatusCodes',
    Parameters    : [
        {
            $Type            : 'Common.ValueListParameterInOut',
            LocalDataProperty: status,
            ValueListProperty: 'code'
        },
        {
            $Type            : 'Common.ValueListParameterDisplayOnly',
            ValueListProperty: 'text'
        }
    ]
});
