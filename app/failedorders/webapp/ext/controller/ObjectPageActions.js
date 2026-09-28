sap.ui.define([
    "sap/ui/core/routing/History",
    "sap/ui/core/routing/HashChanger"
], function (
    History,
    HashChanger
) {
    "use strict";

    function navigateToFailedOrdersList() {
        const oHistory = History.getInstance();
        const sPreviousHash = oHistory.getPreviousHash();

        if (sPreviousHash !== undefined) {
            window.history.go(-1);
            return;
        }

        HashChanger.getInstance().setHash("");
    }

    return {
        onBack: function () {
            navigateToFailedOrdersList();
        }
    };
});
