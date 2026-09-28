const cds = require("@sap/cds");
const onPremPG = require("@octanner/cap-postgres-onprem-connector");

function boolFromEnv(value, defaultValue) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    return String(value).toLowerCase() === "true";
}

function numberFromEnv(value, defaultValue) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const n = Number(value);
    return Number.isFinite(n) ? n : defaultValue;
}

function maskValue(value) {
    if (!value) {
        return "";
    }

    const text = String(value);

    if (text.length <= 4) {
        return "****";
    }

    return text.substring(0, 2) + "****" + text.substring(text.length - 2);
}

function applyEnvironmentDatabaseConfig() {
    const portalEnv = (process.env.PORTAL_ENV || "").toLowerCase();

    const isCloudRuntime =
        process.env.NODE_ENV === "production" ||
        process.env.CDS_ENV === "production" ||
        ["dev", "qa", "prod"].includes(portalEnv);

    if (!isCloudRuntime) {
        console.log("[orders-portal] Local development mode detected. Using package.json development DB config.");
        return;
    }

    const required = [
        "PORTAL_DB_HOST",
        "PORTAL_DB_DATABASE",
        "PORTAL_DB_USER",
        "PORTAL_DB_PASSWORD"
    ];

    const missing = required.filter(function (name) {
        return !process.env[name];
    });

    if (missing.length) {
        console.warn(
            "[orders-portal] Dynamic DB configuration not fully provided. Missing: " +
            missing.join(", ")
        );
        return;
    }

    cds.env.requires = cds.env.requires || {};
    cds.env.requires.db = cds.env.requires.db || {};

    cds.env.requires.db.kind = "postgres";
    cds.env.requires.db.impl = "@cap-js/postgres";
    cds.env.requires.db.credentials = {
        host: process.env.PORTAL_DB_HOST,
        port: numberFromEnv(process.env.PORTAL_DB_PORT, 5432),
        database: process.env.PORTAL_DB_DATABASE,
        user: process.env.PORTAL_DB_USER,
        password: process.env.PORTAL_DB_PASSWORD,
        ssl: boolFromEnv(process.env.PORTAL_DB_SSL, false)
    };

    if (process.env.PORTAL_DB_LOCATION_ID) {
        process.env.CLOUD_CONNECTOR_LOCATION_ID = process.env.PORTAL_DB_LOCATION_ID;
    }

    console.log(
        "[orders-portal] Dynamic DB configuration applied. " +
        "env=" + (process.env.PORTAL_ENV || "production") +
        ", host=" + process.env.PORTAL_DB_HOST +
        ", port=" + numberFromEnv(process.env.PORTAL_DB_PORT, 5432) +
        ", database=" + process.env.PORTAL_DB_DATABASE +
        ", user=" + maskValue(process.env.PORTAL_DB_USER) +
        ", ssl=" + boolFromEnv(process.env.PORTAL_DB_SSL, false) +
        ", locationId=" + (process.env.PORTAL_DB_LOCATION_ID || "not-set")
    );
}

function applyOnPremConnectorPatch() {
    const portalEnv = (process.env.PORTAL_ENV || "").toLowerCase();

    const shouldPatch =
        process.env.NODE_ENV === "production" ||
        process.env.CDS_ENV === "production" ||
        ["dev", "qa", "prod"].includes(portalEnv);

    if (!shouldPatch) {
        console.log("[orders on-prem connector] Local development mode detected. Connector patch not applied.");
        return;
    }

    const locationId = process.env.PORTAL_DB_LOCATION_ID;

    if (!locationId) {
        throw new Error("PORTAL_DB_LOCATION_ID is required for on-prem PostgreSQL connectivity.");
    }


    if (onPremPG && typeof onPremPG.patchCAP === "function") {
        onPremPG.patchCAP({
            cloudConnectorLocationId: locationId
        });

        console.log(
            "[orders on-prem connector] CAP PostgreSQL on-prem connector patch applied. " +
            "locationId=" + locationId
        );
        return;
    }

    console.warn("[orders on-prem connector] patchCAP function was not found.");
}

/*
 * Important order:
 * 1. Apply DB config first.
 * 2. Apply on-prem connector patch second.
 * 3. Export CAP server.
 */
applyEnvironmentDatabaseConfig() *
    applyOnPremConnectorPatch();

module.exports = cds.server;