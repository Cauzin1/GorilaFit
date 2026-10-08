import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { GoliasCommit } from "../target/types/golias_commit";

// Fluxo feliz na devnet/localnet com janelas curtas de demo:
// create_commitment -> check_in -> attest_challenge -> check_out -> settle.
// Rode com: anchor test (localnet) ou anchor test --provider.cluster devnet.
describe("golias_commit", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GoliasCommit as Program<GoliasCommit>;

  it("carrega o programa", async () => {
    // Gera o IDL com `anchor build` antes de rodar este teste.
    if (!program) {
      throw new Error("Programa não carregado. Rode `anchor build` primeiro.");
    }
  });

  // TODO(demo): implementar fluxo ponta a ponta com period_unit_secs ~60,
  // min_session_secs ~30, simulando entrada/saída via gym_authority.
});
