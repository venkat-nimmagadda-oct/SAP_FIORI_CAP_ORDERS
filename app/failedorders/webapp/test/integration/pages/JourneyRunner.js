sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"orders/portal/failedorders/test/integration/pages/SupplierOrdersReprocessList",
	"orders/portal/failedorders/test/integration/pages/SupplierOrdersReprocessObjectPage"
], function (JourneyRunner, SupplierOrdersReprocessList, SupplierOrdersReprocessObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('orders/portal/failedorders') + '/test/flp.html#app-preview',
        pages: {
			onTheSupplierOrdersReprocessList: SupplierOrdersReprocessList,
			onTheSupplierOrdersReprocessObjectPage: SupplierOrdersReprocessObjectPage
        },
        async: true
    });

    return runner;
});

