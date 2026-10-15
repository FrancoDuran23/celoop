import { Suspense } from "react";
import { getDb } from "@/db";
import { linkAllows, linkErrorMessage } from "@/lib/wallet/links";
import { chainReader, pageChainConfig, treasuryAddress } from "@/lib/wallet/server";
import { NO_PASSKEY_MESSAGE, firstParam, pageSession } from "@/lib/wallet/session";
import { loadProposeContext } from "@/lib/wallet/views";
import { Loading, Problem } from "../_components/ui";
import { ProposeForm } from "./propose-form";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function ProposePage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Propose {...props} />
    </Suspense>
  );
}

type Loaded = { ok: true; props: Parameters<typeof ProposeForm>[0] } | { ok: false; message: string };

async function load(token: string | null): Promise<Loaded> {
  try {
    const db = getDb();
    const session = await pageSession(db, token, ["sign"]);
    if (!session.ok) return session;
    if (!linkAllows(session.link, "propose")) return { ok: false, message: linkErrorMessage("wrong_target") };
    if (!session.credential || !session.safe) return { ok: false, message: NO_PASSKEY_MESSAGE };
    const [context, config] = await Promise.all([loadProposeContext(db, chainReader), pageChainConfig()]);
    return {
      ok: true,
      props: {
        context,
        treasury: treasuryAddress(),
        signer: { token: token!, credential: session.credential, safe: session.safe, ...config },
        name: session.link.person.name,
      },
    };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "We couldn't load the page. Try again in a bit." };
  }
}

async function Propose({ searchParams }: Props) {
  const loaded = await load(firstParam((await searchParams).t));
  if (!loaded.ok) return <Problem message={loaded.message} />;
  return <ProposeForm {...loaded.props} />;
}
