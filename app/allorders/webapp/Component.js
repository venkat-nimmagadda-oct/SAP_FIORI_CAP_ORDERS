(function () {
    "use strict";

    var hash = window.location.hash || "";

    // Work Zone / Launchpad semantic intent cleanup for All Orders.
    if (hash.indexOf("#PurchaseOrder-display") === 0) {
        window.history.replaceState(
            null,
            document.title,
            window.location.pathname + window.location.search + "#"
        );
    }
}());

sap.ui.define(
    ["sap/fe/core/AppComponent"],
    function (Component) {
        "use strict";

        return Component.extend("orders.portal.allorders.Component", {
            metadata: {
                manifest: "json"
            }
        });
    }
);