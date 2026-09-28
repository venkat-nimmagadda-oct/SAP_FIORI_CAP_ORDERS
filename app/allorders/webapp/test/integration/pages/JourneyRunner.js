sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"orders/portal/allorders/test/integration/pages/AllOrdersList",
	"orders/portal/allorders/test/integration/pages/AllOrdersObjectPage"
], function (JourneyRunner, AllOrdersList, AllOrdersObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('orders/portal/allorders') + '/test/flp.html#app-preview',
        pages: {
			onTheAllOrdersList: AllOrdersList,
			onTheAllOrdersObjectPage: AllOrdersObjectPage
        },
        async: true
    });

    return runner;
});

