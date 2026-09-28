(function () {
    "use strict";

    var hash = window.location.hash || "";

    // Work Zone / Launchpad sometimes opens the standalone app with the FLP semantic intent:
    // #FailedOrder-manage?sap-ui-app-id-hint=...
    // Fiori Elements router then incorrectly treats "FailedOrder-manage" as an app route/resource path.
    // Clear it before FE AppComponent initializes so the default List Report route ":?query:" can render.
    if (hash.indexOf("#FailedOrder-manage") === 0) {
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

        return Component.extend("orders.portal.failedorders.Component", {
            metadata: {
                manifest: "json"
            }
        });
    }
);