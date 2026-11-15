import { describe, expect, it } from "vitest";
import { verifierNouveauMotDePasse } from "@/lib/mot-de-passe";

describe("verifierNouveauMotDePasse", () => {
  it("accepte un nouveau mot de passe valide", () => {
    expect(verifierNouveauMotDePasse("ancien-mdp", "nouveau-mdp-1", "nouveau-mdp-1")).toBeNull();
  });
  it("exige l'ancien mot de passe", () => {
    expect(verifierNouveauMotDePasse("", "nouveau-mdp-1", "nouveau-mdp-1")).toMatch(/actuel/);
  });
  it("refuse moins de 8 caractères", () => {
    expect(verifierNouveauMotDePasse("ancien-mdp", "court", "court")).toMatch(/8 caractères/);
  });
  it("refuse une confirmation différente", () => {
    expect(verifierNouveauMotDePasse("ancien-mdp", "nouveau-mdp-1", "nouveau-mdp-2")).toMatch(/correspondent/);
  });
  it("refuse de réutiliser l'ancien mot de passe", () => {
    expect(verifierNouveauMotDePasse("meme-mdp-123", "meme-mdp-123", "meme-mdp-123")).toMatch(/différent/);
  });
});
