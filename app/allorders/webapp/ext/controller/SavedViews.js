sap.ui.define([
    "sap/ui/core/Element",
    "sap/ui/mdc/p13n/StateUtil",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/List",
    "sap/m/StandardListItem",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/VBox",
    "sap/ui/core/CustomData"
], function (
    Element,
    StateUtil,
    MessageToast,
    MessageBox,
    Dialog,
    List,
    StandardListItem,
    Button,
    Input,
    Label,
    VBox,
    CustomData
) {
    "use strict";

    const VIEW_NAME = "ALL_ORDERS";
    const APP_ID_FRAGMENT = "orders.portal.allorders";

    /*
     * SavedViews.js for All Orders
     *
     * Purpose:
     * - Save user-specific All Orders filters in UserFilterVariants.
     * - Save visible table columns, column order, and supported table state.
     * - Restore filters and table state when Apply View is selected.
     *
     * Important:
     * - This is a plain action-handler module.
     * - Do not register it under sap.ui.controllerExtensions.
     * - It runs only from the Save View and Apply View manifest actions.
     */

    function getAllElements() {
        if (
            Element &&
            Element.registry &&
            typeof Element.registry.all === "function"
        ) {
            const mAll = Element.registry.all();

            return Object.keys(mAll).map(function (sId) {
                return mAll[sId];
            });
        }

        return [];
    }

    function isVisibleControl(oControl) {
        if (!oControl) {
            return false;
        }

        if (
            typeof oControl.getVisible === "function" &&
            oControl.getVisible() === false
        ) {
            return false;
        }

        const oDomRef = typeof oControl.getDomRef === "function"
            ? oControl.getDomRef()
            : null;

        return Boolean(oDomRef);
    }

    function findControlByType(sType) {
        const aMatches = getAllElements().filter(function (oControl) {
            return Boolean(
                oControl &&
                typeof oControl.isA === "function" &&
                oControl.isA(sType)
            );
        });

        if (!aMatches.length) {
            return null;
        }

        const oAppVisibleMatch = aMatches.find(function (oControl) {
            const sId = typeof oControl.getId === "function"
                ? oControl.getId()
                : "";

            return (
                sId.indexOf(APP_ID_FRAGMENT) >= 0 &&
                isVisibleControl(oControl)
            );
        });

        if (oAppVisibleMatch) {
            return oAppVisibleMatch;
        }

        const oVisibleMatch = aMatches.find(isVisibleControl);

        return oVisibleMatch || aMatches[0];
    }

    function getFilterBar() {
        return findControlByType("sap.ui.mdc.FilterBar");
    }

    function getMdcTable() {
        return findControlByType("sap.ui.mdc.Table");
    }

    function getInnerGridTable() {
        return findControlByType("sap.ui.table.Table");
    }

    function getODataModel(oEvent) {
        const aCandidates = [
            getFilterBar(),
            getMdcTable(),
            getInnerGridTable(),
            oEvent && typeof oEvent.getSource === "function"
                ? oEvent.getSource()
                : null
        ];

        for (let i = 0; i < aCandidates.length; i++) {
            const oCandidate = aCandidates[i];

            if (
                oCandidate &&
                typeof oCandidate.getModel === "function" &&
                oCandidate.getModel()
            ) {
                return oCandidate.getModel();
            }
        }

        return null;
    }

    function getCurrentFilterState() {
        const oFilterBar = getFilterBar();

        if (
            !oFilterBar ||
            typeof oFilterBar.getFilterConditions !== "function"
        ) {
            return {};
        }

        const oConditions = oFilterBar.getFilterConditions() || {};

        console.log(
            "[SAVED_VIEWS] Captured filter conditions:",
            oConditions
        );

        return oConditions;
    }

    function applyFilterStateWithoutSearch(oFilterState) {
        const oFilterBar = getFilterBar();

        if (
            !oFilterBar ||
            typeof oFilterBar.setFilterConditions !== "function"
        ) {
            MessageBox.warning(
                "Filter bar could not be found. Saved filters cannot be applied."
            );

            return false;
        }

        console.log(
            "[SAVED_VIEWS] Applying filter conditions:",
            oFilterState || {}
        );

        oFilterBar.setFilterConditions(oFilterState || {});

        return true;
    }

    async function triggerFilterSearch() {
        const oFilterBar = getFilterBar();

        if (!oFilterBar) {
            return;
        }

        if (typeof oFilterBar.triggerSearch === "function") {
            await oFilterBar.triggerSearch();
            return;
        }

        if (typeof oFilterBar.fireSearch === "function") {
            oFilterBar.fireSearch();
        }
    }

    async function getTableStateBestEffort() {
        const oMdcTable = getMdcTable();

        if (!oMdcTable) {
            return null;
        }

        try {
            if (
                StateUtil &&
                typeof StateUtil.retrieveExternalState === "function"
            ) {
                const oState = await StateUtil.retrieveExternalState(oMdcTable);

                console.log(
                    "[SAVED_VIEWS] Captured MDC table state:",
                    oState
                );

                return oState;
            }

            if (typeof oMdcTable.getCurrentState === "function") {
                return oMdcTable.getCurrentState();
            }
        } catch (oError) {
            console.error(
                "[SAVED_VIEWS] Could not capture table state:",
                oError
            );
        }

        return null;
    }

    function getColumnLabelText(oColumn) {
        if (!oColumn || typeof oColumn.getLabel !== "function") {
            return null;
        }

        const oLabel = oColumn.getLabel();

        if (oLabel && typeof oLabel.getText === "function") {
            return oLabel.getText();
        }

        return null;
    }

    function normalizeKey(sValue) {
        if (!sValue) {
            return "";
        }

        let sKey = String(sValue);

        if (sKey.indexOf("::") >= 0) {
            const aParts = sKey.split("::");
            sKey = aParts[aParts.length - 1];
        }

        sKey = sKey
            .replace(/-innerColumn$/i, "")
            .replace(/-column$/i, "")
            .replace(/_innerColumn$/i, "")
            .replace(/_column$/i, "")
            .replace(/^C::/i, "")
            .replace(/^C:/i, "");

        return sKey
            .replace(/^.*\//, "")
            .replace(/\s+/g, "")
            .replace(/#/g, "")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toLowerCase();
    }

    function addColumnAlias(mAliases, sAlias, oColumn) {
        const sNormalized = normalizeKey(sAlias);

        if (sNormalized) {
            mAliases[sNormalized] = oColumn;
        }
    }

    function getColumnKey(oColumn) {
        if (!oColumn) {
            return null;
        }

        if (typeof oColumn.data === "function") {
            const aDirectKeys = [
                oColumn.data("p13nKey"),
                oColumn.data("columnKey"),
                oColumn.data("leadingProperty"),
                oColumn.data("propertyKey")
            ].filter(Boolean);

            if (aDirectKeys.length) {
                return aDirectKeys[0];
            }
        }

        if (typeof oColumn.getCustomData === "function") {
            const aCustomData = oColumn.getCustomData() || [];

            for (let i = 0; i < aCustomData.length; i++) {
                const oCustomData = aCustomData[i];

                if (
                    !oCustomData ||
                    typeof oCustomData.getKey !== "function" ||
                    oCustomData.getKey() !== "p13nData"
                ) {
                    continue;
                }

                let vValue = typeof oCustomData.getValue === "function"
                    ? oCustomData.getValue()
                    : null;

                try {
                    if (typeof vValue === "string") {
                        vValue = JSON.parse(vValue);
                    }

                    if (vValue) {
                        return (
                            vValue.columnKey ||
                            vValue.leadingProperty ||
                            vValue.sortProperty ||
                            vValue.filterProperty ||
                            vValue.name ||
                            null
                        );
                    }
                } catch (oError) {
                    console.warn(
                        "[SAVED_VIEWS] Invalid p13nData for column:",
                        oColumn.getId && oColumn.getId(),
                        oError
                    );
                }
            }
        }

        if (
            typeof oColumn.getSortProperty === "function" &&
            oColumn.getSortProperty()
        ) {
            return oColumn.getSortProperty();
        }

        if (
            typeof oColumn.getFilterProperty === "function" &&
            oColumn.getFilterProperty()
        ) {
            return oColumn.getFilterProperty();
        }

        if (typeof oColumn.getTemplate === "function") {
            const oTemplate = oColumn.getTemplate();

            if (oTemplate && typeof oTemplate.getBindingInfo === "function") {
                const oTextBinding = oTemplate.getBindingInfo("text");

                if (oTextBinding) {
                    if (oTextBinding.path) {
                        return oTextBinding.path;
                    }

                    if (
                        oTextBinding.parts &&
                        oTextBinding.parts.length &&
                        oTextBinding.parts[0].path
                    ) {
                        return oTextBinding.parts[0].path;
                    }
                }
            }
        }

        return getColumnLabelText(oColumn);
    }

    function collectColumnAliases(oColumn) {
        const mAliases = {};

        if (!oColumn) {
            return mAliases;
        }

        addColumnAlias(mAliases, getColumnKey(oColumn), oColumn);

        if (typeof oColumn.getId === "function") {
            addColumnAlias(mAliases, oColumn.getId(), oColumn);
        }

        if (typeof oColumn.getSortProperty === "function") {
            addColumnAlias(mAliases, oColumn.getSortProperty(), oColumn);
        }

        if (typeof oColumn.getFilterProperty === "function") {
            addColumnAlias(mAliases, oColumn.getFilterProperty(), oColumn);
        }

        addColumnAlias(mAliases, getColumnLabelText(oColumn), oColumn);

        return mAliases;
    }

    function findMatchingColumn(
        sNormalizedSavedKey,
        mColumnsByNormalizedKey
    ) {
        if (mColumnsByNormalizedKey[sNormalizedSavedKey]) {
            return mColumnsByNormalizedKey[sNormalizedSavedKey];
        }

        const aRuntimeKeys = Object.keys(mColumnsByNormalizedKey);

        for (let i = 0; i < aRuntimeKeys.length; i++) {
            const sRuntimeKey = aRuntimeKeys[i];

            if (
                sRuntimeKey === sNormalizedSavedKey ||
                sRuntimeKey.indexOf(sNormalizedSavedKey) >= 0 ||
                sNormalizedSavedKey.indexOf(sRuntimeKey) >= 0
            ) {
                return mColumnsByNormalizedKey[sRuntimeKey];
            }
        }

        return null;
    }

    function applyGridTableColumnLayoutFallback(oTableState) {
        if (!oTableState || !Array.isArray(oTableState.items)) {
            return false;
        }

        const oGridTable = getInnerGridTable();

        if (
            !oGridTable ||
            typeof oGridTable.getColumns !== "function" ||
            typeof oGridTable.removeAllColumns !== "function" ||
            typeof oGridTable.addColumn !== "function"
        ) {
            return false;
        }

        const aSavedKeys = oTableState.items
            .map(function (oItem) {
                return oItem && (oItem.key || oItem.name);
            })
            .filter(Boolean);

        if (!aSavedKeys.length) {
            return false;
        }

        const aCurrentColumns = oGridTable.getColumns().slice();
        const mColumnsByNormalizedKey = {};

        aCurrentColumns.forEach(function (oColumn) {
            const mAliases = collectColumnAliases(oColumn);

            Object.keys(mAliases).forEach(function (sAlias) {
                mColumnsByNormalizedKey[sAlias] = oColumn;
            });
        });

        console.log(
            "[SAVED_VIEWS] Saved variant tableState keys:",
            aSavedKeys
        );

        console.log(
            "[SAVED_VIEWS] Runtime GridTable columns:",
            aCurrentColumns.map(function (oColumn) {
                return {
                    id: oColumn.getId && oColumn.getId(),
                    key: getColumnKey(oColumn),
                    normalizedKey: normalizeKey(getColumnKey(oColumn)),
                    label: getColumnLabelText(oColumn),
                    visible: oColumn.getVisible && oColumn.getVisible()
                };
            })
        );

        const aVisibleColumns = [];
        const aHiddenColumns = [];
        const oMatchedColumns = new Set();

        aSavedKeys.forEach(function (sSavedKey) {
            const sNormalizedSavedKey = normalizeKey(sSavedKey);
            const oColumn = findMatchingColumn(
                sNormalizedSavedKey,
                mColumnsByNormalizedKey
            );

            if (oColumn && !oMatchedColumns.has(oColumn)) {
                oMatchedColumns.add(oColumn);

                if (typeof oColumn.setVisible === "function") {
                    oColumn.setVisible(true);
                }

                aVisibleColumns.push(oColumn);
            } else if (!oColumn) {
                console.warn(
                    "[SAVED_VIEWS] Could not match saved column key:",
                    sSavedKey
                );
            }
        });

        aCurrentColumns.forEach(function (oColumn) {
            if (!oMatchedColumns.has(oColumn)) {
                if (typeof oColumn.setVisible === "function") {
                    oColumn.setVisible(false);
                }

                aHiddenColumns.push(oColumn);
            }
        });

        if (!aVisibleColumns.length) {
            return false;
        }

        oGridTable.removeAllColumns();

        aVisibleColumns.forEach(function (oColumn) {
            oGridTable.addColumn(oColumn);
        });

        /*
         * Hidden columns remain attached to the table so that users can
         * enable them again from the standard table personalization dialog.
         */
        aHiddenColumns.forEach(function (oColumn) {
            oGridTable.addColumn(oColumn);
        });

        if (typeof oGridTable.invalidate === "function") {
            oGridTable.invalidate();
        }

        console.log(
            "[SAVED_VIEWS] Column layout applied:",
            {
                visible: aVisibleColumns.map(getColumnKey),
                hidden: aHiddenColumns.map(getColumnKey)
            }
        );

        return true;
    }

    async function applyTableStateBestEffort(oTableState) {
        if (!oTableState) {
            console.warn(
                "[SAVED_VIEWS] No table state was stored in the selected view."
            );

            return false;
        }

        const oMdcTable = getMdcTable();
        let bStateUtilApplied = false;

        if (
            oMdcTable &&
            StateUtil &&
            typeof StateUtil.applyExternalState === "function"
        ) {
            try {
                console.log(
                    "[SAVED_VIEWS] Applying MDC table state:",
                    oTableState
                );

                await StateUtil.applyExternalState(
                    oMdcTable,
                    oTableState
                );

                bStateUtilApplied = true;
            } catch (oError) {
                console.warn(
                    "[SAVED_VIEWS] StateUtil table apply failed. " +
                    "Using GridTable fallback.",
                    oError
                );
            }
        }

        try {
            const bGridLayoutApplied =
                applyGridTableColumnLayoutFallback(oTableState);

            if (bGridLayoutApplied) {
                return true;
            }
        } catch (oError) {
            console.error(
                "[SAVED_VIEWS] GridTable layout fallback failed:",
                oError
            );
        }

        if (bStateUtilApplied) {
            return true;
        }

        if (
            oMdcTable &&
            typeof oMdcTable.setCurrentState === "function"
        ) {
            try {
                oMdcTable.setCurrentState(oTableState);
                return true;
            } catch (oError) {
                console.warn(
                    "[SAVED_VIEWS] setCurrentState fallback failed:",
                    oError
                );
            }
        }

        return false;
    }

    async function buildPayload(sVariantName) {
        const oTableState = await getTableStateBestEffort();
        const oFilterState = getCurrentFilterState();

        const oPayload = {
            /*
             * CAP replaces the placeholder with the authenticated user
             * before CREATE UserFilterVariants.
             */
            userId: "CURRENT_USER",
            viewName: VIEW_NAME,
            variantName: sVariantName,
            filterJSON: JSON.stringify({
                filters: oFilterState,
                tableState: oTableState
            }),
            isDefault: false
        };

        console.log(
            "[SAVED_VIEWS] Saving variant payload:",
            oPayload
        );

        return oPayload;
    }

    async function createVariant(oModel, oPayload) {
        const oListBinding = oModel.bindList(
            "/UserFilterVariants",
            null,
            [],
            [],
            {
                $$updateGroupId: "$direct"
            }
        );

        const oContext = oListBinding.create(oPayload);

        if (oContext && typeof oContext.created === "function") {
            await oContext.created();
        }

        return oContext;
    }

    async function loadVariantEntries(oModel) {
        const oListBinding = oModel.bindList(
            "/UserFilterVariants",
            null,
            [],
            [],
            {
                $$updateGroupId: "$direct"
            }
        );

        const aContexts =
            await oListBinding.requestContexts(0, 100);

        const aEntries = aContexts
            .map(function (oContext) {
                return {
                    context: oContext,
                    variant: oContext.getObject()
                };
            })
            .filter(function (oEntry) {
                return (
                    oEntry.variant &&
                    oEntry.variant.viewName === VIEW_NAME
                );
            });

        console.log(
            "[SAVED_VIEWS] Loaded variant entries:",
            aEntries.map(function (oEntry) {
                return oEntry.variant;
            })
        );

        return aEntries;
    }

    async function loadVariants(oModel) {
        const aEntries = await loadVariantEntries(oModel);

        return aEntries.map(function (oEntry) {
            return oEntry.variant;
        });
    }

    function normalizeVariantName(sName) {
        return String(sName || "")
            .trim()
            .toLocaleLowerCase();
    }

    async function findVariantsByName(
        oModel,
        sVariantName
    ) {
        const sNormalizedName =
            normalizeVariantName(sVariantName);

        const aEntries = await loadVariantEntries(oModel);

        return aEntries.filter(function (oEntry) {
            return (
                normalizeVariantName(
                    oEntry.variant.variantName
                ) === sNormalizedName
            );
        });
    }

    function confirmAction(sMessage, sTitle) {
        return new Promise(function (resolve) {
            MessageBox.confirm(sMessage, {
                title: sTitle,
                emphasizedAction: MessageBox.Action.OK,
                actions: [
                    MessageBox.Action.OK,
                    MessageBox.Action.CANCEL
                ],
                onClose: function (sAction) {
                    resolve(
                        sAction === MessageBox.Action.OK
                    );
                }
            });
        });
    }

    async function updateVariantContext(
        oContext,
        oPayload
    ) {
        if (
            !oContext ||
            typeof oContext.setProperty !== "function"
        ) {
            throw new Error(
                "Saved view context is not available for update."
            );
        }

        await oContext.setProperty(
            "variantName",
            oPayload.variantName
        );

        await oContext.setProperty(
            "filterJSON",
            oPayload.filterJSON
        );

        await oContext.setProperty(
            "isDefault",
            Boolean(oPayload.isDefault)
        );
    }

    async function deleteVariantContext(oContext) {
        if (
            !oContext ||
            typeof oContext.delete !== "function"
        ) {
            throw new Error(
                "Saved view context is not available for deletion."
            );
        }

        await oContext.delete("$direct");
    }

    function getSelectedVariantEntry(oList) {
        const oSelectedItem = oList.getSelectedItem();

        if (!oSelectedItem) {
            return null;
        }

        const aCustomData =
            oSelectedItem.getCustomData();

        if (!aCustomData.length) {
            return null;
        }

        return aCustomData[0].getValue();
    }

    function addVariantItems(oList, aEntries) {
        oList.removeAllItems();

        aEntries.forEach(function (oEntry) {
            const oVariant = oEntry.variant;

            oList.addItem(new StandardListItem({
                title: oVariant.variantName,
                description:
                    oVariant.isDefault ? "Default" : "",
                type: "Active",
                customData: [
                    new CustomData({
                        key: "variantEntry",
                        value: oEntry
                    })
                ]
            }));
        });
    }

    return {
        saveView: function (oEvent) {
            const oFilterBar = getFilterBar();
            const oModel = getODataModel(oEvent);

            if (!oFilterBar) {
                MessageBox.error(
                    "Filter bar could not be found. " +
                    "Cannot save view."
                );
                return;
            }

            if (!oModel) {
                MessageBox.error(
                    "OData model is not available. " +
                    "Cannot save view."
                );
                return;
            }

            const oNameInput = new Input({
                placeholder:
                    "Example: All Orders - US Completed",
                width: "100%"
            });

            const oDialog = new Dialog({
                title: "Save View",
                contentWidth: "420px",
                content: new VBox({
                    width: "100%",
                    items: [
                        new Label({
                            text: "View name"
                        }),
                        oNameInput
                    ]
                }),
                beginButton: new Button({
                    text: "Save",
                    type: "Emphasized",
                    press: async function () {
                        const sVariantName =
                            (
                                oNameInput.getValue() || ""
                            ).trim();

                        if (!sVariantName) {
                            MessageToast.show(
                                "Please enter a view name."
                            );
                            return;
                        }

                        try {
                            const oPayload =
                                await buildPayload(
                                    sVariantName
                                );

                            const aMatches =
                                await findVariantsByName(
                                    oModel,
                                    sVariantName
                                );

                            if (aMatches.length > 1) {
                                MessageBox.warning(
                                    "More than one saved view " +
                                    "already uses this name. " +
                                    "Use Apply View to delete " +
                                    "the unwanted duplicates " +
                                    "before saving again."
                                );
                                return;
                            }

                            if (aMatches.length === 1) {
                                const bOverwrite =
                                    await confirmAction(
                                        "A saved view named \"" +
                                        sVariantName +
                                        "\" already exists. " +
                                        "Replace it with the " +
                                        "current filters and " +
                                        "table layout?",
                                        "Replace Saved View"
                                    );

                                if (!bOverwrite) {
                                    return;
                                }

                                await updateVariantContext(
                                    aMatches[0].context,
                                    oPayload
                                );

                                MessageToast.show(
                                    "Existing view updated."
                                );
                            } else {
                                await createVariant(
                                    oModel,
                                    oPayload
                                );

                                MessageToast.show(
                                    "View saved."
                                );
                            }

                            oDialog.close();
                        } catch (oError) {
                            MessageBox.error(
                                "Could not save view: " +
                                (
                                    oError.message ||
                                    oError
                                )
                            );
                        }
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        applyView: async function (oEvent) {
            const oFilterBar = getFilterBar();
            const oModel = getODataModel(oEvent);

            if (!oFilterBar) {
                MessageBox.error(
                    "Filter bar could not be found. " +
                    "Cannot manage saved views."
                );
                return;
            }

            if (!oModel) {
                MessageBox.error(
                    "OData model is not available. " +
                    "Cannot manage saved views."
                );
                return;
            }

            try {
                let aEntries =
                    await loadVariantEntries(oModel);

                if (!aEntries.length) {
                    MessageToast.show(
                        "No saved views found."
                    );
                    return;
                }

                const oList = new List({
                    mode: "SingleSelectMaster"
                });

                addVariantItems(oList, aEntries);

                const oDialog = new Dialog({
                    title: "Manage Saved Views",
                    contentWidth: "520px",
                    contentHeight: "380px",
                    content: [oList],
                    buttons: [
                        new Button({
                            text: "Apply",
                            type: "Emphasized",
                            press: async function () {
                                const oEntry =
                                    getSelectedVariantEntry(
                                        oList
                                    );

                                if (!oEntry) {
                                    MessageToast.show(
                                        "Please select a " +
                                        "saved view."
                                    );
                                    return;
                                }

                                const oVariant =
                                    oEntry.variant;

                                let oState = {};

                                try {
                                    oState = JSON.parse(
                                        oVariant.filterJSON ||
                                        "{}"
                                    );
                                } catch (oError) {
                                    MessageBox.error(
                                        "Saved view is not " +
                                        "valid JSON."
                                    );
                                    return;
                                }

                                console.log(
                                    "[SAVED_VIEWS] " +
                                    "Selected variant:",
                                    oVariant
                                );

                                const bFilterApplied =
                                    applyFilterStateWithoutSearch(
                                        oState.filters || {}
                                    );

                                const bTableApplied =
                                    await applyTableStateBestEffort(
                                        oState.tableState ||
                                        null
                                    );

                                await triggerFilterSearch();

                                if (
                                    bFilterApplied &&
                                    bTableApplied
                                ) {
                                    MessageToast.show(
                                        "Saved filters and " +
                                        "table layout applied."
                                    );
                                } else if (
                                    bFilterApplied
                                ) {
                                    MessageToast.show(
                                        "Saved filters applied. " +
                                        "Table layout could not " +
                                        "be fully restored."
                                    );
                                } else {
                                    MessageBox.warning(
                                        "The saved view could " +
                                        "not be fully applied."
                                    );
                                }

                                oDialog.close();
                            }
                        }),
                        new Button({
                            text: "Update",
                            press: async function () {
                                const oEntry =
                                    getSelectedVariantEntry(
                                        oList
                                    );

                                if (!oEntry) {
                                    MessageToast.show(
                                        "Please select a " +
                                        "saved view."
                                    );
                                    return;
                                }

                                const sVariantName =
                                    oEntry.variant
                                        .variantName;

                                const bConfirmed =
                                    await confirmAction(
                                        "Replace \"" +
                                        sVariantName +
                                        "\" with the current " +
                                        "filters and table " +
                                        "layout?",
                                        "Update Saved View"
                                    );

                                if (!bConfirmed) {
                                    return;
                                }

                                try {
                                    const oPayload =
                                        await buildPayload(
                                            sVariantName
                                        );

                                    await updateVariantContext(
                                        oEntry.context,
                                        oPayload
                                    );

                                    MessageToast.show(
                                        "Saved view updated."
                                    );

                                    oDialog.close();
                                } catch (oError) {
                                    MessageBox.error(
                                        "Could not update " +
                                        "saved view: " +
                                        (
                                            oError.message ||
                                            oError
                                        )
                                    );
                                }
                            }
                        }),
                        new Button({
                            text: "Delete",
                            type: "Reject",
                            press: async function () {
                                const oEntry =
                                    getSelectedVariantEntry(
                                        oList
                                    );

                                if (!oEntry) {
                                    MessageToast.show(
                                        "Please select a " +
                                        "saved view."
                                    );
                                    return;
                                }

                                const sVariantName =
                                    oEntry.variant
                                        .variantName;

                                const bConfirmed =
                                    await confirmAction(
                                        "Delete the saved view \"" +
                                        sVariantName +
                                        "\"? This action cannot " +
                                        "be undone.",
                                        "Delete Saved View"
                                    );

                                if (!bConfirmed) {
                                    return;
                                }

                                try {
                                    await deleteVariantContext(
                                        oEntry.context
                                    );

                                    MessageToast.show(
                                        "Saved view deleted."
                                    );

                                    aEntries =
                                        await loadVariantEntries(
                                            oModel
                                        );

                                    if (!aEntries.length) {
                                        oDialog.close();
                                        return;
                                    }

                                    addVariantItems(
                                        oList,
                                        aEntries
                                    );
                                } catch (oError) {
                                    MessageBox.error(
                                        "Could not delete " +
                                        "saved view: " +
                                        (
                                            oError.message ||
                                            oError
                                        )
                                    );
                                }
                            }
                        }),
                        new Button({
                            text: "Cancel",
                            press: function () {
                                oDialog.close();
                            }
                        })
                    ],
                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                oDialog.open();
            } catch (oError) {
                MessageBox.error(
                    "Could not load saved views: " +
                    (oError.message || oError)
                );
            }
        }
    };
});