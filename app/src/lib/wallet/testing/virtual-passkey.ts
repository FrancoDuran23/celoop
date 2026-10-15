// A software WebAuthn authenticator for tests: a P-256 key generated here plays the passkey, and
// `getFn` stands in for navigator.credentials.get with a real assertion (authenticatorData,
// clientDataJSON, DER signature) that Safe's WebAuthn signer verifies on chain.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { Hex } from "viem";
import type { PasskeyCredential, PasskeySafeOptions } from "../account";

type GetFn = NonNullable<PasskeySafeOptions["getFn"]>;

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash("sha256").update(data).digest());
const toArrayBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;
const fromBufferSource = (source: BufferSource) =>
  source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

export type VirtualPasskey = { credential: PasskeyCredential; getFn: GetFn; signatures: () => number };

export function createVirtualPasskey(opts: { rpId?: string; origin?: string } = {}): VirtualPasskey {
  const rpIdDefault = opts.rpId ?? "localhost";
  const origin = opts.origin ?? "http://localhost:3000";
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  const id = randomBytes(16).toString("base64url");
  let count = 0;

  const getFn = (async (options?: CredentialRequestOptions) => {
    const request = options?.publicKey;
    if (!request) throw new Error("publicKey request options missing");
    const challenge = Buffer.from(fromBufferSource(request.challenge)).toString("base64url");
    const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false });
    const flags = 0x05; // user present + user verified
    const authenticatorData = new Uint8Array([...sha256(request.rpId ?? rpIdDefault), flags, 0, 0, 0, ++count]);
    const signed = new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]);
    const signature = new Uint8Array(sign("sha256", signed, { key: privateKey, dsaEncoding: "der" }));
    return {
      id,
      type: "public-key",
      rawId: toArrayBuffer(Buffer.from(id, "base64url")),
      authenticatorAttachment: "platform",
      response: {
        authenticatorData: toArrayBuffer(authenticatorData),
        clientDataJSON: toArrayBuffer(new TextEncoder().encode(clientDataJSON)),
        signature: toArrayBuffer(signature),
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    } as unknown as Credential;
  }) as GetFn;

  return {
    credential: { id, publicKey: `0x04${x.toString("hex")}${y.toString("hex")}` as Hex },
    getFn,
    signatures: () => count,
  };
}
