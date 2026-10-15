import { Suspense } from "react";
import { getDb } from "@/db";
import { linkAllows, linkErrorMessage } from "@/lib/wallet/links";
import { chainReader, pageChainConfig, treasuryAddress } from "@/lib/wallet/server";
import { NO_PASSKEY_MESSAGE, firstParam, pageSession } from "@/lib/wallet/session";
import { loadPaymentView } from "@/lib/wallet/views";
import { Loading, Problem } from "../../_components/ui";
import { PaymentSigner } from "./payment-signer";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function PaymentPage(props: Props) {
  return (
    <Suspense fallback={<Loading label="Finding the payment…" />}>
      <Payment {...props} />
    </Suspense>
  );
}

type Loaded = { ok: true; props: Parameters<typeof PaymentSigner>[0] } | { ok: false; message: string };

async function load(id: string, token: string | null): Promise<Loaded> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, message: "We couldn't find this payment." };
  const paymentId = BigInt(id);
  try {
    const db = getDb();
    const session = await pageSession(db, token, ["sign"]);
    if (!session.ok) return session;
    if (!linkAllows(session.link, "payment", paymentId)) return { ok: false, message: linkErrorMessage("wrong_target") };
    if (!session.credential || !session.safe) return { ok: false, message: NO_PASSKEY_MESSAGE };
    const [view, config] = await Promise.all([loadPaymentView(db, chainReader, paymentId, session.safe), pageChainConfig()]);
    if (!view) return { ok: false, message: "We couldn't find this payment. The link may be old." };
    return {
      ok: true,
      props: {
        view,
        treasury: treasuryAddress(),
        signer: { token: token!, credential: session.credential, safe: session.safe, ...config },
        name: session.link.person.name,
      },
    };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "We couldn't load the payment. Try again in a bit." };
  }
}

async function Payment({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = await load(id, firstParam(query.t));
  if (!loaded.ok) return <Problem message={loaded.message} />;
  return <PaymentSigner {...loaded.props} />;
}
