sap.ui.define(
    [
        "sap/ui/core/routing/History",
        "sap/ui/core/routing/HashChanger"
    ],
    function (
        History,
        HashChanger
    ) {
        "use strict";

        function navigateToAllOrdersList() {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            /*
             * Normal navigation:
             *
             * All Orders List
             * -> User opens an order
             * -> User clicks Back
             * -> Return to the previous list state
             */
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
                return;
            }

            /*
             * Direct navigation:
             *
             * The detail page may have been opened using
             * a bookmark, copied URL, refresh, or new tab.
             *
             * The empty hash opens the default All Orders
             * List Report route.
             */
            HashChanger.getInstance().setHash("");
        }

        return {
            onBack: function () {
                navigateToAllOrdersList();
            }
        };
    }
);