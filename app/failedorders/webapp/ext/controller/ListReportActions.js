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
        aContexts
    ) {
        if (
            !Array.isArray(aContexts) ||
            aContexts.length === 0
        ) {
            return;
        }

        const oModel =
            aContexts[0].getModel();

        if (
            oModel &&
            typeof oModel.refresh === "function"
        ) {
            oModel.refresh();
        }
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

            refreshModel(aContexts);

            if (iFailureCount === 0) {
                await showSuccess(
                    getSuccessMessage(
                        iSuccessCount,
                        mSettings.singleSuccess,
                        mSettings.pluralSuccess
                    ),
                    mSettings.successTitle
                );

                return;
            }

            if (iSuccessCount > 0) {
                await showPartialResult(
                    iSuccessCount,
                    iFailureCount,
                    mSettings.partialActionLabel
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
                        "for reprocessing."
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
                        "could not be cancelled."
                }
            );
        }
    };
});