sap.ui.define([
    "sap/m/MessageBox"
], function (
    MessageBox
) {
    "use strict";

    const RESEND_ACTION =
        "SupplierOrderService.resend";

    const CANCEL_ACTION =
        "SupplierOrderService.cancel";

    /*
     * CPI processing is asynchronous after HTTP 202.
     * These refreshes only re-read the list. They do not resend.
     */
    const RESEND_REFRESH_DELAYS_MS = [
        0,
        2000,
        5000,
        10000
    ];

    const CANCEL_REFRESH_DELAY_MS = 300;

    let bActionInProgress = false;

    function resolveContexts(
        oContext,
        aSelectedContexts
    ) {
        if (
            Array.isArray(aSelectedContexts) &&
            aSelectedContexts.length > 0
        ) {
            return aSelectedContexts;
        }

        if (
            Array.isArray(oContext) &&
            oContext.length > 0
        ) {
            return oContext;
        }

        if (
            oContext &&
            typeof oContext.getModel === "function"
        ) {
            return [oContext];
        }

        return [];
    }

    function getModelFromContexts(
        aContexts
    ) {
        if (
            !Array.isArray(aContexts) ||
            aContexts.length === 0
        ) {
            return null;
        }

        const oContext = aContexts[0];

        if (
            !oContext ||
            typeof oContext.getModel !== "function"
        ) {
            return null;
        }

        return oContext.getModel();
    }

    function showConfirmation(
        sMessage,
        sActionButton,
        sTitle
    ) {
        return new Promise(function (resolve) {
            MessageBox.confirm(sMessage, {
                title: sTitle,
                actions: [
                    sActionButton,
                    MessageBox.Action.CANCEL
                ],
                emphasizedAction:
                    sActionButton,
                onClose:
                    function (sSelectedAction) {
                        resolve(
                            sSelectedAction ===
                                sActionButton
                        );
                    }
            });
        });
    }

    function showSuccess(
        sMessage,
        sTitle
    ) {
        return new Promise(function (resolve) {
            MessageBox.success(sMessage, {
                title: sTitle,
                actions: [
                    MessageBox.Action.OK
                ],
                emphasizedAction:
                    MessageBox.Action.OK,
                onClose: function () {
                    resolve();
                }
            });
        });
    }

    function showPartialResult(
        iSuccessCount,
        iFailureCount,
        sActionLabel
    ) {
        return new Promise(function (resolve) {
            MessageBox.warning(
                iSuccessCount +
                    " message(s) completed " +
                    sActionLabel +
                    ". " +
                    iFailureCount +
                    " message(s) failed.",
                {
                    title:
                        "Action Partially Completed",
                    actions: [
                        MessageBox.Action.OK
                    ],
                    emphasizedAction:
                        MessageBox.Action.OK,
                    onClose: function () {
                        resolve();
                    }
                }
            );
        });
    }

    async function executeBoundAction(
        oContext,
        sActionName
    ) {
        if (!oContext) {
            throw new Error(
                "The selected failed order " +
                "could not be identified."
            );
        }

        const oModel = oContext.getModel();

        if (
            !oModel ||
            typeof oModel.bindContext !== "function"
        ) {
            throw new Error(
                "The OData model is not available."
            );
        }

        const oActionBinding =
            oModel.bindContext(
                sActionName + "(...)",
                oContext
            );

        await oActionBinding.execute();

        return oModel;
    }

    function refreshModel(
        oModel
    ) {
        if (
            oModel &&
            typeof oModel.refresh === "function"
        ) {
            oModel.refresh();
        }
    }

    function scheduleModelRefreshes(
        oModel,
        aRefreshDelays
    ) {
        if (
            !oModel ||
            !Array.isArray(aRefreshDelays)
        ) {
            return;
        }

        aRefreshDelays.forEach(function (iDelayMs) {
            window.setTimeout(function () {
                refreshModel(oModel);
            }, iDelayMs);
        });
    }

    function getConfirmationMessage(
        iSelectedCount,
        sSingularMessage,
        sPluralAction
    ) {
        if (iSelectedCount === 1) {
            return sSingularMessage;
        }

        return (
            "Are you sure you want to " +
            sPluralAction +
            " the selected " +
            iSelectedCount +
            " messages?"
        );
    }

    function getSuccessMessage(
        iSuccessCount,
        sSingularMessage,
        sPluralMessage
    ) {
        if (iSuccessCount === 1) {
            return sSingularMessage;
        }

        return (
            iSuccessCount +
            " " +
            sPluralMessage
        );
    }

    async function processSelectedOrders(
        oContext,
        aSelectedContexts,
        mSettings
    ) {
        if (bActionInProgress) {
            return;
        }

        const aContexts =
            resolveContexts(
                oContext,
                aSelectedContexts
            );

        if (aContexts.length === 0) {
            MessageBox.warning(
                "Select at least one failed order.",
                {
                    title:
                        "No Orders Selected"
                }
            );

            return;
        }

        /*
         * Capture the model before refreshes invalidate or replace
         * any of the selected row contexts.
         */
        const oModel =
            getModelFromContexts(aContexts);

        if (!oModel) {
            MessageBox.error(
                "The OData model is not available.",
                {
                    title:
                        mSettings.errorTitle
                }
            );

            return;
        }

        const sConfirmationMessage =
            getConfirmationMessage(
                aContexts.length,
                mSettings.singleConfirmation,
                mSettings.pluralAction
            );

        const bConfirmed =
            await showConfirmation(
                sConfirmationMessage,
                mSettings.actionButton,
                mSettings.confirmationTitle
            );

        if (!bConfirmed) {
            return;
        }

        bActionInProgress = true;

        try {
            const aResults =
                await Promise.allSettled(
                    aContexts.map(
                        function (oSelectedContext) {
                            return executeBoundAction(
                                oSelectedContext,
                                mSettings.actionName
                            );
                        }
                    )
                );

            const iSuccessCount =
                aResults.filter(
                    function (oResult) {
                        return (
                            oResult.status ===
                            "fulfilled"
                        );
                    }
                ).length;

            const iFailureCount =
                aResults.length -
                iSuccessCount;

            if (iFailureCount === 0) {
                await showSuccess(
                    getSuccessMessage(
                        iSuccessCount,
                        mSettings.singleSuccess,
                        mSettings.pluralSuccess
                    ),
                    mSettings.successTitle
                );

                /*
                 * Refresh only after the user closes the popup.
                 *
                 * For Resend, repeat the refresh because CPI returns
                 * HTTP 202 before final processing is complete.
                 *
                 * For Cancel, one refresh is sufficient because the
                 * CAP cancellation transaction completes synchronously.
                 */
                scheduleModelRefreshes(
                    oModel,
                    mSettings.refreshDelays
                );

                return;
            }

            if (iSuccessCount > 0) {
                await showPartialResult(
                    iSuccessCount,
                    iFailureCount,
                    mSettings.partialActionLabel
                );

                scheduleModelRefreshes(
                    oModel,
                    mSettings.refreshDelays
                );

                return;
            }

            const oFirstFailure =
                aResults.find(
                    function (oResult) {
                        return (
                            oResult.status ===
                            "rejected"
                        );
                    }
                );

            throw (
                oFirstFailure &&
                oFirstFailure.reason
                    ? oFirstFailure.reason
                    : new Error(
                        mSettings.errorMessage
                    )
            );
        } catch (oError) {
            MessageBox.error(
                oError && oError.message
                    ? oError.message
                    : mSettings.errorMessage,
                {
                    title:
                        mSettings.errorTitle
                }
            );
        } finally {
            bActionInProgress = false;
        }
    }

    return {
        onResend: function (
            oContext,
            aSelectedContexts
        ) {
            return processSelectedOrders(
                oContext,
                aSelectedContexts,
                {
                    actionName:
                        RESEND_ACTION,

                    confirmationTitle:
                        "Confirm Resend",

                    singleConfirmation:
                        "Are you sure you want " +
                        "to resend the selected order?",

                    pluralAction:
                        "resend",

                    actionButton:
                        "Resend",

                    successTitle:
                        "Resend Submitted",

                    singleSuccess:
                        "The selected message was " +
                        "submitted for reprocessing.",

                    pluralSuccess:
                        "selected messages were " +
                        "submitted for reprocessing.",

                    partialActionLabel:
                        "for reprocessing",

                    errorTitle:
                        "Resend Failed",

                    errorMessage:
                        "The selected message(s) " +
                        "could not be submitted " +
                        "for reprocessing.",

                    /*
                     * Re-read Failed Orders immediately and again
                     * while CPI completes asynchronous processing.
                     */
                    refreshDelays:
                        RESEND_REFRESH_DELAYS_MS
                }
            );
        },

        onCancelMessage: function (
            oContext,
            aSelectedContexts
        ) {
            return processSelectedOrders(
                oContext,
                aSelectedContexts,
                {
                    actionName:
                        CANCEL_ACTION,

                    confirmationTitle:
                        "Confirm Cancellation",

                    singleConfirmation:
                        "Are you sure you want " +
                        "to cancel the selected message?",

                    pluralAction:
                        "cancel",

                    actionButton:
                        "Cancel Message",

                    successTitle:
                        "Cancellation Successful",

                    singleSuccess:
                        "The selected message was " +
                        "successfully cancelled.",

                    pluralSuccess:
                        "selected messages were " +
                        "successfully cancelled.",

                    partialActionLabel:
                        "for cancellation",

                    errorTitle:
                        "Cancellation Failed",

                    errorMessage:
                        "The selected message(s) " +
                        "could not be cancelled.",

                    /*
                     * Cancel is completed inside the CAP request,
                     * so only one refresh is required.
                     */
                    refreshDelays: [
                        CANCEL_REFRESH_DELAY_MS
                    ]
                }
            );
        }
    };
});