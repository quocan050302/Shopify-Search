/**
 * SWAI KH-02 V12.4.3.3.1 — Semantic Product Family Classification Tests
 *
 * Validates G12 fix: two water fountain products from different brands must share the
 * same family key (`pet_water_fountain`) and not count as distinct product families.
 *
 * Also verifies:
 * - UNRESOLVED_FAMILY fallback for single-token / brand-only titles
 * - Correct family rejection for niche-contamination cases (golf, crochet, dog food)
 */

import { describe, it, expect } from "vitest";
import { buildProductIdentityFingerprint } from "../../../src/services/kh02/identity/productDistinctnessEngine";
import type { DistinctnessCandidateLike } from "../../../src/services/kh02/identity/productDistinctnessEngine";

function makeCandidate(
  id: string,
  title: string,
  overrides: Partial<DistinctnessCandidateLike> = {}
): DistinctnessCandidateLike {
  return {
    candidateId: id,
    title,
    displayName: title,
    canonicalProductName: title,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// G12 — Two water fountains must share pet_water_fountain family
// ---------------------------------------------------------------------------
describe("G12: pet_water_fountain family classification", () => {
  it("KittySpout Wireless Fountain → pet_water_fountain", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c1", "KittySpout Wireless Fountain")
    );
    expect(fp.familyKey).toBe("pet_water_fountain");
  });

  it("Pawira Stainless Steel Water Fountain → pet_water_fountain", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c2", "Pawira Stainless Steel Water Fountain")
    );
    expect(fp.familyKey).toBe("pet_water_fountain");
  });

  it("Two water fountains share the same family — NOT counted as 2 distinct families", () => {
    const fp1 = buildProductIdentityFingerprint(
      makeCandidate("c1", "KittySpout Wireless Fountain")
    );
    const fp2 = buildProductIdentityFingerprint(
      makeCandidate("c2", "Pawira Stainless Steel Water Fountain")
    );
    expect(fp1.familyKey).toBe(fp2.familyKey);
  });

  it("Cat water fountain → pet_water_fountain", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c3", "Cat Water Fountain Stainless Steel 84oz")
    );
    expect(fp.familyKey).toBe("pet_water_fountain");
  });

  it("Dog drinking fountain → pet_water_fountain", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c4", "PETLIBRO Dog Drinking Water Fountain")
    );
    expect(fp.familyKey).toBe("pet_water_fountain");
  });

  it("Pet fountain pump → pet_water_fountain", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c5", "Replacement Fountain Pump for Cat Fountain")
    );
    expect(fp.familyKey).toBe("pet_water_fountain");
  });
});

// ---------------------------------------------------------------------------
// G12 — Feeder, hair remover, and fountain are DISTINCT families
// ---------------------------------------------------------------------------
describe("G12: distinct families — feeder, fountain, hair remover", () => {
  it("Automatic Pet Feeder → automatic_pet_feeder", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c10", "UAHPET Fresh Food Automatic Pet Feeder")
    );
    expect(fp.familyKey).toBe("automatic_pet_feeder");
  });

  it("Pet hair remover → pet_hair_remover_roller", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c11", "Pet Hair Remover Roller Reusable")
    );
    expect(fp.familyKey).toBe("pet_hair_remover_roller");
  });

  it("Three different families are counted as 3", () => {
    const families = [
      buildProductIdentityFingerprint(makeCandidate("a", "UAHPET Automatic Pet Feeder")).familyKey,
      buildProductIdentityFingerprint(makeCandidate("b", "KittySpout Wireless Fountain")).familyKey,
      buildProductIdentityFingerprint(makeCandidate("c", "Pet Hair Remover Roller")).familyKey,
    ];
    const distinctCount = new Set(families).size;
    expect(distinctCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// G12 — Niche contamination — mismatched family keys
// ---------------------------------------------------------------------------
describe("G12: niche contamination — wrong family rejection", () => {
  it("Golf organizer pouch → NOT car_accessories family", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c20", "Golf Organizer Pouch Clip")
    );
    expect(fp.familyKey).not.toBe("car_accessories");
    expect(fp.familyKey).not.toBe("car_organizer_holder");
  });

  it("Crochet kit → NOT diy_tools family", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c21", "Learn to Crochet Starter Kit")
    );
    // Crochet is not in PRODUCT_FAMILY_RULES for diy_tools, so it gets a token-based or unresolved key
    expect(fp.familyKey).not.toBe("diy_tools");
    expect(fp.familyKey).not.toBe("hot_glue_gun");
  });

  it("Dog food bundle → NOT pet_gadgets family", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c22", "Purina Pro Plan Dog Food Bundle")
    );
    expect(fp.familyKey).not.toBe("pet_water_fountain");
    expect(fp.familyKey).not.toBe("automatic_pet_feeder");
    expect(fp.familyKey).not.toBe("gps_pet_tracker_collar");
    expect(fp.familyKey).not.toBe("interactive_pet_toy");
  });
});

// ---------------------------------------------------------------------------
// G12 — Oil sprayer / oil dispenser share same family
// ---------------------------------------------------------------------------
describe("G12: oil dispenser and oil sprayer share oil_dispenser_sprayer", () => {
  it("Oil sprayer → oil_dispenser_sprayer", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c30", "Olive Oil Sprayer Bottle for Cooking")
    );
    expect(fp.familyKey).toBe("oil_dispenser_sprayer");
  });

  it("Oil dispenser → oil_dispenser_sprayer", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c31", "Premium Oil Dispenser Kitchen")
    );
    expect(fp.familyKey).toBe("oil_dispenser_sprayer");
  });

  it("Both share exact same familyKey", () => {
    const fp1 = buildProductIdentityFingerprint(
      makeCandidate("c30", "Olive Oil Sprayer Bottle for Cooking")
    );
    const fp2 = buildProductIdentityFingerprint(
      makeCandidate("c31", "Premium Oil Dispenser Kitchen")
    );
    expect(fp1.familyKey).toBe(fp2.familyKey);
  });
});

// ---------------------------------------------------------------------------
// G12 — UNRESOLVED_FAMILY fallback for brand-only or insufficient tokens
// ---------------------------------------------------------------------------
describe("G12: UNRESOLVED_FAMILY for brand-only titles (< 2 semantic tokens)", () => {
  it("Brand-only single word → unresolved_family", () => {
    const fp = buildProductIdentityFingerprint(
      makeCandidate("c40", "Swiffer")
    );
    // Only 1 token after filtering generics — cannot form a reliable composite family
    expect(fp.familyKey).toBe("unresolved_family");
  });

  it("All-generic tokens → unresolved_family", () => {
    // 'New', 'the', 'pro', 'max' are all generic/filtered, leaving 0 meaningful tokens
    const fp = buildProductIdentityFingerprint(makeCandidate("c41", "New Pro Max"));
    expect(fp.familyKey).toBe("unresolved_family");
  });
});
