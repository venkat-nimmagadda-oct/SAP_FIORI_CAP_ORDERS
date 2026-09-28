sap.ui.define(['sap/fe/test/ListReport'], function(ListReport) {
    'use strict';

    var CustomPageDefinitions = {
        actions: {},
        assertions: {}
    };

    return new ListReport(
        {
            appId: 'orders.portal.allorders',
            componentId: 'AllOrdersList',
            contextPath: '/AllOrders'
        },
        CustomPageDefinitions
    );
});