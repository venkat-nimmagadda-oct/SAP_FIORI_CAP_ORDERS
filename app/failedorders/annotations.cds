using SupplierOrderService as service from '../../srv/service';

annotate service.SupplierOrdersReprocess with @(
    UI.HeaderInfo: {
        TypeName       : 'Failed Order',
        TypeNamePlural : 'Failed Orders',
        Title          : {
            $Type : 'UI.DataField',
            Value : purchaseOrderNumber
        },
        Description    : {
            $Type : 'UI.DataField',
            Value : supplierName
        }
    },

    UI.SelectionFields: [
        purchaseOrderNumber,
        supplier,
        supplierName,
        salesOrg,
        country,
        salesOrderNumber,
        octMaterialNumber,
        changedBy
    ],

    UI.Identification: [],

    UI.LineItem: [
        {
            $Type             : 'UI.DataField',
            Value             : purchaseOrderNumber,
            Label             : 'PO Number',
            ![@UI.Importance] : #High
        },
        {
            $Type             : 'UI.DataField',
            Value             : poLineNumber,
            Label             : 'PO Line',
            ![@UI.Importance] : #High
        },
        {
            $Type             : 'UI.DataField',
            Value             : supplier,
            Label             : 'Vendor #',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : supplierName,
            Label             : 'Vendor Name',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : salesOrg,
            Label             : 'Sales Org',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : errorText,
            Label             : 'Error',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : lastRetryDate,
            Label             : 'Last Retry',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : reprocessCounter,
            Label             : 'Retry Count',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : changedBy,
            Label             : 'Last Retried By',
            ![@UI.Importance] : #Medium
        },
        {
            $Type             : 'UI.DataField',
            Value             : salesOrderNumber,
            Label             : 'SO Number',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : country,
            Label             : 'Country',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : octMaterialNumber,
            Label             : 'OCT Material',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : vendorMaterialNumber,
            Label             : 'Vendor Material',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : tdLine,
            Label             : 'TD Line',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : purchaseOrderDate,
            Label             : 'Order Date',
            ![@UI.Importance] : #Low
        },
        {
            $Type             : 'UI.DataField',
            Value             : customErrorText,
            Label             : 'Custom Error',
            ![@UI.Importance] : #Low
        }
    ],

    UI.Facets: [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'OrderDetails',
            Label  : 'Order Details',
            Target : '@UI.FieldGroup#OrderInfo'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'MaterialDetails',
            Label  : 'Material Information',
            Target : '@UI.FieldGroup#MaterialInfo'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ProcessingDetails',
            Label  : 'Processing Information',
            Target : '@UI.FieldGroup#ProcessingInfo'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'PayloadDetails',
            Label  : 'Raw Payload',
            Target : '@UI.FieldGroup#PayloadInfo'
        }
    ],

    UI.FieldGroup #OrderInfo: {
        Label : 'Order Information',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : purchaseOrderNumber,
                Label : 'PO Number'
            },
            {
                $Type : 'UI.DataField',
                Value : poLineNumber,
                Label : 'PO Line Number'
            },
            {
                $Type : 'UI.DataField',
                Value : salesOrderNumber,
                Label : 'SO Number'
            },
            {
                $Type : 'UI.DataField',
                Value : supplier,
                Label : 'Vendor Number'
            },
            {
                $Type : 'UI.DataField',
                Value : supplierName,
                Label : 'Vendor Name'
            },
            {
                $Type : 'UI.DataField',
                Value : country,
                Label : 'Country'
            },
            {
                $Type : 'UI.DataField',
                Value : salesOrg,
                Label : 'Sales Org'
            },
            {
                $Type : 'UI.DataField',
                Value : purchaseOrderDate,
                Label : 'Order Date'
            }
        ]
    },

    UI.FieldGroup #MaterialInfo: {
        Label : 'Material Information',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : octMaterialNumber,
                Label : 'OCT Material Number'
            },
            {
                $Type : 'UI.DataField',
                Value : vendorMaterialNumber,
                Label : 'Vendor Material Number'
            },
            {
                $Type : 'UI.DataField',
                Value : tdLine,
                Label : 'TD Line'
            }
        ]
    },

    UI.FieldGroup #ProcessingInfo: {
        Label : 'Processing Information',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : errorText,
                Label : 'Error Text'
            },
            {
                $Type : 'UI.DataField',
                Value : customErrorText,
                Label : 'Custom Error Text'
            },
            {
                $Type : 'UI.DataField',
                Value : lastRetryDate,
                Label : 'Last Retry Timestamp'
            },
            {
                $Type : 'UI.DataField',
                Value : reprocessCounter,
                Label : 'Retry Count'
            },
            {
                $Type : 'UI.DataField',
                Value : changedBy,
                Label : 'Last Retried By'
            },
            {
                $Type : 'UI.DataField',
                Value : receiverIflowName,
                Label : 'Receiver iFlow'
            }
        ]
    },

    UI.FieldGroup #PayloadInfo: {
        Label : 'Raw Payload',
        Data  : [
            {
                $Type : 'UI.DataField',
                Value : rawData,
                Label : 'JSON Payload'
            }
        ]
    },

    Capabilities.DeleteRestrictions: {
        Deletable : false
    }
);

annotate service.SupplierOrdersReprocess with {
    isProcessing  @UI.Hidden;
    lockedBy      @UI.Hidden;
    lockedAt      @UI.Hidden;
    lockExpiresAt @UI.Hidden;

    // supplierReferenceNumber @UI.Hidden;

    companyCode   @UI.Hidden;
    createdBy     @UI.Hidden;
    createdOn     @UI.Hidden;
    changedOn     @UI.Hidden;
    status        @UI.Hidden;
};