using SupplierOrderService as service from '../../srv/service';

annotate service.OrderHistory with @(
    UI.HeaderInfo: {
        TypeName       : 'Order',
        TypeNamePlural : 'Orders',
        Title          : { $Type: 'UI.DataField', Value: purchaseOrderNumber },
        Description    : { $Type: 'UI.DataField', Value: supplierName }
    },

    UI.SelectionFields: [
        purchaseOrderNumber, supplier, supplierName,
        salesOrg, country, salesOrderNumber,
        status, purchaseOrderDate, processedBy, cancelledBy
    ],

    UI.LineItem: [
        { $Type: 'UI.DataField', Value: purchaseOrderNumber, Label: 'PO Number',     ![@UI.Importance]: #High },
        { $Type: 'UI.DataField', Value: poLineNumber,        Label: 'PO Line',       ![@UI.Importance]: #High },
        { $Type: 'UI.DataField', Value: supplier,            Label: 'Vendor #',      ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: supplierName,        Label: 'Vendor Name',   ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: salesOrg,            Label: 'Sales Org',     ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: purchaseOrderDate,   Label: 'Order Date',    ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: status,              Label: 'Status',        ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: processedAt,         Label: 'Processed At',  ![@UI.Importance]: #Medium },
        { $Type: 'UI.DataField', Value: processedBy,         Label: 'Processed By',  ![@UI.Importance]: #Medium },

        { $Type: 'UI.DataField', Value: salesOrderNumber,    Label: 'SO Number',       ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: country,             Label: 'Country',         ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: octMaterialNumber,   Label: 'OCT Material',    ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: vendorMaterialNumber,Label: 'Vendor Material', ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: errorText,           Label: 'Error',           ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: cancelledAt,         Label: 'Cancelled At',    ![@UI.Importance]: #Low },
        { $Type: 'UI.DataField', Value: cancelledBy,         Label: 'Cancelled By',    ![@UI.Importance]: #Low }
    ],

    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', ID: 'OrderDetails',    Label: 'Order Details',        Target: '@UI.FieldGroup#OrderInfo' },
        { $Type: 'UI.ReferenceFacet', ID: 'MaterialDetails', Label: 'Material Information', Target: '@UI.FieldGroup#MaterialInfo' },
        { $Type: 'UI.ReferenceFacet', ID: 'StatusInfo',      Label: 'Status & Audit',       Target: '@UI.FieldGroup#StatusInfo' }
    ],

    UI.FieldGroup #OrderInfo: {
        Label: 'Order Information',
        Data : [
            { $Type: 'UI.DataField', Value: purchaseOrderNumber },
            { $Type: 'UI.DataField', Value: poLineNumber },
            { $Type: 'UI.DataField', Value: salesOrderNumber },
            { $Type: 'UI.DataField', Value: supplier },
            { $Type: 'UI.DataField', Value: supplierName },
            { $Type: 'UI.DataField', Value: country },
            { $Type: 'UI.DataField', Value: salesOrg },
            { $Type: 'UI.DataField', Value: purchaseOrderDate }
        ]
    },

    UI.FieldGroup #MaterialInfo: {
        Label: 'Material Information',
        Data : [
            { $Type: 'UI.DataField', Value: octMaterialNumber },
            { $Type: 'UI.DataField', Value: vendorMaterialNumber }
        ]
    },

    UI.FieldGroup #StatusInfo: {
        Label: 'Status & Audit',
        Data : [
            { $Type: 'UI.DataField', Value: status },
            { $Type: 'UI.DataField', Value: errorText },
            { $Type: 'UI.DataField', Value: cancelledBy },
            { $Type: 'UI.DataField', Value: cancelledAt },
            { $Type: 'UI.DataField', Value: processedBy },
            { $Type: 'UI.DataField', Value: processedAt },
            { $Type: 'UI.DataField', Value: sourceTable }
        ]
    },

    Capabilities.DeleteRestrictions: { Deletable: false },
    Capabilities.InsertRestrictions: { Insertable: false },
    Capabilities.UpdateRestrictions: { Updatable: false }
);