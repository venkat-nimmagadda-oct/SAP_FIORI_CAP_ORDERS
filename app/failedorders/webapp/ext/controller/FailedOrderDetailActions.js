sap.ui.define([
    "sap/m/MessageBox",
    "sap/ui/core/routing/History",
    "sap/ui/core/routing/HashChanger"
], function (
    MessageBox,
    History,
    HashChanger
) {
    "use strict";

    const RESEND_ACTION =
        "SupplierOrderService.resend";

    const CANCEL_ACTION =
        "SupplierOrderService.cancel";

    let bActionInProgress = false;

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
                emphasizedAction: sActionButton,
                onClose: function (sSelectedAction) {
                    resolve(
                        sSelectedAction === sActionButton
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

    function resolveContext(
        oContext,
        aSelectedContexts
    ) {
        if (
            oContext &&
            typeof oContext.getModel === "function" &&
            typeof oContext.getPath === "function"
        ) {
            return oContext;
        }

        if (
            Array.isArray(aSelectedContexts) &&
            aSelectedContexts.length > 0
        ) {
            return aSelectedContexts[0];
        }

        return null;
    }

    async function executeAction(
        oContext,
        sActionName
    ) {
        if (!oContext) {
            throw new Error(
                "The failed order could not be identified."
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

    function navigateToFailedOrdersList(oModel) {
        const oHistory = History.getInstance();
        const sPreviousHash =
            oHistory.getPreviousHash();

        if (sPreviousHash !== undefined) {
            window.history.go(-1);
        } else {
            HashChanger
                .getInstance()
                .setHash("");
        }

        if (
            oModel &&
            typeof oModel.refresh === "function"
        ) {
            window.setTimeout(function () {
                oModel.refresh();
            }, 300);
        }
    }

    function getErrorMessage(
        oError,
        sFallbackMessage
    ) {
        if (oError && oError.message) {
            return oError.message;
        }

        return sFallbackMessage;
    }

    async function processAction(
        oContext,
        aSelectedContexts,
        mSettings
    ) {
        if (bActionInProgress) {
            return;
        }

        const oResolvedContext =
            resolveContext(
                oContext,
                aSelectedContexts
            );

        if (!oResolvedContext) {
            MessageBox.error(
                "The failed order could not be " +
                "identified. Return to the list " +
                "and open the order again.",
                {
                    title: mSettings.errorTitle
                }
            );
            return;
        }

        const bConfirmed =
            await showConfirmation(
                mSettings.confirmationMessage,
                mSettings.actionButton,
                mSettings.confirmationTitle
            );

        if (!bConfirmed) {
            return;
        }

        bActionInProgress = true;

        try {
            const oModel =
                await executeAction(
                    oResolvedContext,
                    mSettings.actionName
                );

            await showSuccess(
                mSettings.successMessage,
                mSettings.successTitle
            );

            navigateToFailedOrdersList(oModel);
        } catch (oError) {
            MessageBox.error(
                getErrorMessage(
                    oError,
                    mSettings.errorMessage
                ),
                {
                    title: mSettings.errorTitle
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
            return processAction(
                oContext,
                aSelectedContexts,
                {
                    actionName:
                        RESEND_ACTION,

                    confirmationTitle:
                        "Confirm Resend",

                    confirmationMessage:
                        "Are you sure you want " +
                        "to resend this order?",

                    actionButton:
                        "Resend",

                    successTitle:
                        "Resend Submitted",

                    successMessage:
                        "The message was submitted " +
                        "for reprocessing.",

                    errorTitle:
                        "Resend Failed",

                    errorMessage:
                        "The message could not be " +
                        "submitted for reprocessing."
                }
            );
        },

        onCancelMessage: function (
            oContext,
            aSelectedContexts
        ) {
            return processAction(
                oContext,
                aSelectedContexts,
                {
                    actionName:
                        CANCEL_ACTION,

                    confirmationTitle:
                        "Confirm Cancellation",

                    confirmationMessage:
                        "Are you sure you want " +
                        "to cancel this message?",

                    actionButton:
                        "Cancel Message",

                    successTitle:
                        "Cancellation Successful",

                    successMessage:
                        "The message was successfully " +
                        "cancelled.",

                    errorTitle:
                        "Cancellation Failed",

                    errorMessage:
                        "The message could not be " +
                        "cancelled."
                }
            );
        }
    };
});