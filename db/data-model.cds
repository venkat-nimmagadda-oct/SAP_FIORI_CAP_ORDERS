namespace orders.portal;

using {
    cuid,
    managed
} from '@sap/cds/common';

type OrderStatus : Integer enum {
    Complete = 0;
    New = 1;
    Failed = 2;
    Cancelled = 3;
    InProgress = 4;
};

entity SupplierOrdersReprocess {
    key supplierReferenceNumber : String(50) not null   @title: 'Supplier Reference Number';
        id                      : Integer64             @title: 'Technical Record ID';
        purchaseOrderNumber     : String(10) not null   @title: 'PO Number';
        poLineNumber            : String(6) not null    @title: 'PO Line Number';
        salesOrderNumber        : String(10)            @title: 'SO Number';
        supplier                : String(10)            @title: 'Vendor Number';
        supplierName            : String(50)            @title: 'Vendor Name';
        country                 : String(3)             @title: 'Country';
        salesOrg                : String(4)             @title: 'Sales Org';
        companyCode             : String(10)            @title: 'Company Code';
        plant                   : String(10)            @title: 'Plant';
        octMaterialNumber       : String(18)            @title: 'OCT Material Number';
        vendorMaterialNumber    : String(35)            @title: 'Vendor Material Number';
        tdLine                  : String(500)           @title: 'TD Line';
        status                  : OrderStatus           @title: 'Status';
        errorText               : String(500)           @title: 'Error Text';
        customErrorText         : String(1000)          @title: 'Custom Error Text';
        purchaseOrderDate       : Date                  @title: 'Order Date';
        lastRetryDate           : Timestamp             @title: 'Last Retry Timestamp';
        reprocessCounter        : Integer default 0     @title: 'Retry Count';
        receiverIflowName       : String(100)           @title: 'Receiver iFlow';
        rawData                 : LargeString not null  @title: 'Raw JSON Payload';
        createdBy               : String(255)           @title: 'Created By';
        createdOn               : Timestamp             @title: 'Created On';
        changedBy               : String(255)           @title: 'Last Retried By';
        changedOn               : Timestamp             @title: 'Changed On';
        isProcessing            : Boolean default false @title: 'Is Processing';
        lockedBy                : String(255)           @title: 'Locked By';
        lockedAt                : Timestamp             @title: 'Locked At';
        lockExpiresAt           : Timestamp             @title: 'Lock Expires At';
}

entity OrderHistory {
    key ID                   : Integer             @title: 'Record ID';
        purchaseOrderNumber  : String(10) not null @title: 'PO Number';
        poLineNumber         : String(6) not null  @title: 'PO Line Number';
        salesOrderNumber     : String(10)          @title: 'SO Number';
        supplier             : String(10)          @title: 'Vendor Number';
        supplierName         : String(50)          @title: 'Vendor Name';
        country              : String(3)           @title: 'Country';
        salesOrg             : String(4)           @title: 'Sales Org';
        companyCode          : String(10)          @title: 'Company Code';
        plant                : String(10)          @title: 'Plant';
        octMaterialNumber    : String(18)          @title: 'OCT Material Number';
        vendorMaterialNumber : String(35)          @title: 'Vendor Material Number';
        status               : OrderStatus         @title: 'Status';
        errorText            : String(500)         @title: 'Error Text';
        purchaseOrderDate    : Date                @title: 'Order Date';
        processedBy          : String(255)         @title: 'Processed By';
        processedAt          : Timestamp           @title: 'Processed At';
        cancelledBy          : String(255)         @title: 'Cancelled By';
        cancelledAt          : Timestamp           @title: 'Cancelled At';
        sourceTable          : String(30)          @title: 'Source';
        createdBy            : String(255)         @title: 'Created By';
        createdOn            : Timestamp           @title: 'Created On';
}

entity AuditLog : cuid, managed {
    action              : String(30)   @title: 'Action';
    purchaseOrderNumber : String(10)   @title: 'PO Number';
    poLineNumber        : String(6)    @title: 'PO Line Number';
    supplier            : String(10)   @title: 'Vendor Number';
    status              : String(20)   @title: 'Result';
    message             : String(2000) @title: 'Message';
    performedBy         : String(255)  @title: 'Performed By';
    salesOrg            : String(4)    @title: 'Sales Org';
}

entity UserFilterVariants : cuid, managed {
    userId      : String(255)           @title: 'User ID';
    viewName    : String(50)            @title: 'View Name';
    variantName : String(100)           @title: 'Variant Name';
    filterJSON  : LargeString           @title: 'Filter State (JSON)';
    isDefault   : Boolean default false @title: 'Is Default';
}

entity StatusCodes {
    key code : Integer    @title: 'Status Code';
        text : String(50) @title: 'Description';
}
