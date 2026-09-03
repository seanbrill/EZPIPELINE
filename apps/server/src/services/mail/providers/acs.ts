// Azure Communication Services Email, over its REST API.
//
// NO SDK, and that is a deliberate trade. @azure/communication-email pulls in a
// large dependency tree for what is one signed POST, and this project already
// carries one Azure-shaped burden in the provisioning pipelines. The cost is
// that the request signing is ours to get right, so it is written out below
// rather than hidden.
//
// ACS accepts a connection string of the form
//   endpoint=https://<name>.communication.azure.com/;accesskey=<base64>
// which is exactly what the portal hands you, so that is what is asked for -
// one field instead of two that have to be split correctly.

import { createHash, createHmac } from "node:crypto";
import type { MailProvider, SendResult } from "../types.js";
import { httpFailure, missing, present } from "../types.js";

const API_VERSION = "2023-03-31";

/** endpoint + key out of the portal's connection string. */
function parseConnectionString(cs: string): { endpoint: string; key: string } | null {
  const endpoint = /(?:^|;)\s*endpoint=([^;]+)/i.exec(cs)?.[1]?.trim();
  const key = /(?:^|;)\s*accesskey=([^;]+)/i.exec(cs)?.[1]?.trim();
  if (!endpoint || !key) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), key };
}

/**
 * Azure's HMAC scheme, which is picky in ways worth stating.
 *
 * The string to sign is exactly VERB\npath-and-query\ndate;host;content-hash,
 * the date header must be `x-ms-date` in UTC HTTP format, the host must carry
 * no scheme and no trailing slash, and the content hash is base64 of the
 * SHA-256 of the RAW BODY BYTES - not of a re-serialised copy. Signing a
 * differently-formatted body than the one sent produces a 401 that reads as a
 * bad key, so the body is stringified ONCE and both signed and sent.
 */
function sign(
  key: string,
  method: string,
  pathAndQuery: string,
  host: string,
  body: string,
  dateHeader: string
): string {
  const contentHash = createHash("sha256").update(body, "utf8").digest("base64");
  const stringToSign = [method, pathAndQuery, `${dateHeader};${host};${contentHash}`].join("\n");
  const signature = createHmac("sha256", Buffer.from(key, "base64"))
    .update(stringToSign, "utf8")
    .digest("base64");
  return `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`;
}

export const acsProvider: MailProvider = {
  id: "acs",
  label: "Azure Communication Services",
  blurb:
    "Azure's own mail service. Best fit if you already deploy to Azure - it can use an Azure-managed domain, so there is no DNS to set up to get started.",
  fields: [
    { key: "connectionString", label: "Connection string", type: "secret", required: true,
      hint: "Azure portal > your Communication Services resource > Keys. Paste it whole; it contains both the endpoint and the key." },
    { key: "from", label: "Sender address", type: "text",
      placeholder: "DoNotReply@<guid>.azurecomm.net", required: true,
      hint: "From the Email Communication Service's domain. An Azure-managed domain gives you one immediately." },
  ],

  async send(config, msg): Promise<SendResult> {
    const cs = present(config, "connectionString");
    const from = present(config, "from");
    if (!cs || !from) {
      return missing("Azure Communication Services", [!cs ? "connectionString" : "", !from ? "from" : ""].filter(Boolean));
    }
    const parsed = parseConnectionString(cs);
    if (!parsed) {
      return {
        ok: false,
        error:
          "The Azure connection string is not in the expected form. It should look like " +
          "endpoint=https://<name>.communication.azure.com/;accesskey=<key> - paste the whole value from the portal.",
      };
    }

    const pathAndQuery = `/emails:send?api-version=${API_VERSION}`;
    const url = `${parsed.endpoint}${pathAndQuery}`;
    const host = new URL(parsed.endpoint).host;
    // Stringified once: the bytes that are hashed must be the bytes that are sent.
    const body = JSON.stringify({
      senderAddress: from,
      content: {
        subject: msg.subject,
        plainText: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      },
      recipients: { to: [{ address: msg.to }] },
    });
    const dateHeader = new Date().toUTCString();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ms-date": dateHeader,
          "x-ms-content-sha256": createHash("sha256").update(body, "utf8").digest("base64"),
          authorization: sign(parsed.key, "POST", pathAndQuery, host, body, dateHeader),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      // 202 Accepted: ACS queues and reports status separately. Accepted is as
      // much as this application needs to know - it sends codes, not campaigns,
      // and polling an operation id would delay a login for no benefit.
      if (res.ok) return { ok: true };
      const failure = await httpFailure("Azure Communication Services", res);
      if (res.status === 401 || res.status === 403) {
        // NOT VERIFIED AGAINST A LIVE ACS RESOURCE. The scheme below follows
        // Azure's published spec and was checked for shape and determinism,
        // but no real endpoint has accepted a request from it yet. A 401 is
        // therefore ambiguous in a way it is not for the other providers, and
        // saying so beats sending somebody to re-copy a key that was right.
        failure.error +=
          " If the connection string is definitely correct, this may be our request " +
          "signing rather than your key - please report it.";
      }
      return failure;
    } catch (e) {
      return {
        ok: false,
        error: `Azure Communication Services unreachable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
