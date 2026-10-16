import { Suspense } from "react";
import { getDb } from "@/db";
import { linkAllows, linkErrorMessage } from "@/lib/wallet/links";
import { linkScope, pageChainConfig } from "@/lib/wallet/server";
import { NO_PASSKEY_MESSAGE, firstParam, pageSession } from "@/lib/wallet/session";
import { applyExecutedProposal } from "@/lib/wallet/proposal-reason";
import { loadProposalView } from "@/lib/wallet/views";
import { Loading, Problem } from "../../_components/ui";
import { ProposalSigner } from "./proposal-signer";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ProposalPage(props: Props) {
  return (
    <Suspense fallback={<Loading label="Finding the proposal…" />}>
      <Proposal {...props} />
    </Suspense>
  );
}

type Loaded = { ok: true; props: Parameters<typeof ProposalSigner>[0] } | { ok: false; message: string };

async function load(id: string, token: string | null): Promise<Loaded> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, message: "We couldn't find this proposal." };
  const proposalId = BigInt(id);
  try {
    const db = getDb();
    const session = await pageSession(db, token, ["sign"]);
    if (!session.ok) return session;
    if (!linkAllows(session.link, "proposal", proposalId)) return { ok: false, message: linkErrorMessage("wrong_target") };
    if (!session.credential || !session.safe) return { ok: false, message: NO_PASSKEY_MESSAGE };
    const scope = await linkScope(db, session.link);
    const [view, config] = await Promise.all([
      loadProposalView(db, scope.chain, proposalId, session.safe, scope.cooperadoraId),
      pageChainConfig(),
    ]);
    if (!view) return { ok: false, message: "We couldn't find this proposal. The link may be old." };
    // Idempotent: makes sure an executed SetVendor is mirrored in vendors.
    if (view.status === "executed") {
      await applyExecutedProposal(db, scope.chain, proposalId, scope.cooperadoraId).catch(console.error);
    }
    return {
      ok: true,
      props: {
        view,
        treasury: scope.treasury,
        signer: { token: token!, credential: session.credential, safe: session.safe, ...config },
        name: session.link.person.name,
      },
    };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "We couldn't load the proposal. Try again in a bit." };
  }
}

async function Proposal({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = await load(id, firstParam(query.t));
  if (!loaded.ok) return <Problem message={loaded.message} />;
  return <ProposalSigner {...loaded.props} />;
}
