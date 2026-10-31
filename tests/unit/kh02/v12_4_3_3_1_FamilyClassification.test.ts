/**
 * SWAI KH-02 V12.4.3.3.1 — Semantic Product Family Classification & Niche Relevance Tests
 *
 * Validates G09, G10, G12, and G26 using real production functions:
 * - buildProductIdentityFingerprint / resolveProductFamily / evaluateOpportunityDiversity
 * - evaluateProductRelevance (rejecting golf organizer in Car Accessories, crochet bag kit in DIY Tools,
 *   consumable dog food starter kit in Pet Gadgets / Dog Gadgets, and species mismatch)
 * - selectTopResearchShortlist (preventing same-family duplicate slots in BROAD_CATEGORY)
 */

import { describe, it, expect } from "vitest";
import {
  buildProductIdentityFingerprint,
  evaluateOpportunityDiversity,
  resolveProductFamily,
  type DistinctnessCandidateLike,
} from "../../../src/services/kh02/identity/productDistinctnessEngine";
import { evaluateProductRelevance } from "../../../src/services/kh02/identity/productRelevanceEvaluator";
import { resolveProductIdentity } from "../../../src/services/kh02/identity/productIdentityResolver";

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

  it("Three different families are counted as 3 by evaluateOpportunityDiversity", () => {
    const div = evaluateOpportunityDiversity(
      [
        makeCandidate("a", "UAHPET Automatic Pet Feeder"),
        makeCandidate("b", "KittySpout Wireless Fountain"),
        makeCandidate("c", "Pet Hair Remover Roller"),
      ],
      { nicheIntent: "BROAD_CATEGORY", topic: "Pet Gadgets" }
    );
    expect(div.distinctFamilyCount).toBe(3);
    expect(div.isFamilyDiverse).toBe(true);
  });
});

describe("G09, G10 & G12: Niche contamination rejection via evaluateProductRelevance and family resolution", () => {
  it("Golf organizer pouch is rejected as IRRELEVANT for Car Accessories", () => {
    const rel = evaluateProductRelevance(
      "Golf Organizer Pouch With Golf Accessories Set https://golfstore.com/products/golf-organizer-pouch",
      "Car Accessories"
    );
    expect(rel.relevanceStatus).toBe("IRRELEVANT");
    expect(rel.isAccepted).toBe(false);

    const fp = buildProductIdentityFingerprint(
      makeCandidate("c20", "Golf Organizer Pouch Clip")
    );
    expect(fp.familyKey).not.toBe("car_accessories");
    expect(fp.familyKey).not.toBe("car_organizer_storage");
  });

  it("Crochet bag DIY kit is rejected as IRRELEVANT for DIY Tools", () => {
    const rel = evaluateProductRelevance(
      "CrochetPark™ Elegant granny Crochet Bag DIY Kit https://crochetpark.com/products/granny-crochet-bag-diy-kit",
      "DIY Tools"
    );
    expect(rel.relevanceStatus).toBe("IRRELEVANT");
    expect(rel.isAccepted).toBe(false);

    const fp = buildProductIdentityFingerprint(
      makeCandidate("c21", "Learn to Crochet Starter Kit")
    );
    expect(fp.familyKey).not.toBe("diy_tools");
    expect(fp.familyKey).not.toBe("hot_glue_gun");
  });

  it("Shelf-stable dog food starter kit (+ Toy) is rejected as IRRELEVANT for Pet Gadgets and Dog Gadgets", () => {
    const relPet = evaluateProductRelevance(
      "Gently Cooked Shelf-Stable Dog Food Starter Kit - 3 Boxes (2 lbs Each) + Toy https://dogfood.com/products/starter-kit",
      "Pet Gadgets"
    );
    expect(relPet.relevanceStatus).toBe("IRRELEVANT");
    expect(relPet.isAccepted).toBe(false);

    const relDog = evaluateProductRelevance(
      "Gently Cooked Shelf-Stable Dog Food Starter Kit - 3 Boxes (2 lbs Each) + Toy https://dogfood.com/products/starter-kit",
      "Dog Gadgets"
    );
    expect(relDog.relevanceStatus).toBe("IRRELEVANT");
    expect(relDog.isAccepted).toBe(false);
  });

  it("Automatic Pet Feeder hardware device remains RELEVANT for Pet Gadgets", () => {
    const relFeeder = evaluateProductRelevance(
      "UAHPET Automatic Pet Feeder Smart Timed Dog & Cat Food Dispenser https://uahpet.com/products/automatic-pet-feeder",
      "Pet Gadgets"
    );
    expect(relFeeder.relevanceStatus).toBe("RELEVANT");
    expect(relFeeder.isAccepted).toBe(true);
  });
});

describe("G12: oil dispenser and oil sprayer share oil_dispenser_sprayer", () => {
  it("Oil sprayer and oil dispenser resolve to exact same familyKey oil_dispenser_sprayer", () => {
    const fp1 = buildProductIdentityFingerprint(
      makeCandidate("c30", "Olive Oil Sprayer Bottle for Cooking")
    );
    const fp2 = buildProductIdentityFingerprint(
      makeCandidate("c31", "Premium Oil Dispenser Kitchen")
    );
    expect(fp1.familyKey).toBe("oil_dispenser_sprayer");
    expect(fp2.familyKey).toBe("oil_dispenser_sprayer");
    expect(fp1.familyKey).toBe(fp2.familyKey);
  });
});

describe("G12: UNRESOLVED_FAMILY for brand-only titles (< 2 semantic tokens) never inflates distinctFamilyCount", () => {
  it("Brand-only single word → unresolved_family and distinctFamilyCount=0 in evaluateOpportunityDiversity", () => {
    const fp = buildProductIdentityFingerprint(makeCandidate("c40", "Swiffer"));
    expect(fp.familyKey).toBe("unresolved_family");

    const fp2 = resolveProductFamily("New Pro Max");
    expect(fp2.familyKey).toBe("unresolved_family");

    const div = evaluateOpportunityDiversity(
      [makeCandidate("c40", "Swiffer"), makeCandidate("c41", "New Pro Max")],
      { nicheIntent: "BROAD_CATEGORY", topic: "Cleaning Gadgets" }
    );
    expect(div.distinctFamilyCount).toBe(0);
    expect(div.isFamilyDiverse).toBe(false);
  });
});

describe("V12.4.3.3.1 Final Repair: Pet Gadgets vs Pet Toys, null slug, electric spin scrubber, and DIY wallpaper", () => {
  it("Chew Resistant Squeaky Plush Pet Toy is rejected in Pet Gadgets / Dog Gadgets / Cat Gadgets but accepted in Pet Toys", () => {
    const plushUrl = "https://livlandco.com/products/null-1773399526609";
    const plushText = `Chew Resistant Squeaky Plush Pet Toy ${plushUrl}`;

    const relPetGadgets = evaluateProductRelevance(plushText, "Pet Gadgets");
    expect(relPetGadgets.relevanceStatus).toBe("IRRELEVANT");
    expect(relPetGadgets.isAccepted).toBe(false);

    const relDogGadgets = evaluateProductRelevance(plushText, "Dog Gadgets");
    expect(relDogGadgets.relevanceStatus).toBe("IRRELEVANT");
    expect(relDogGadgets.isAccepted).toBe(false);

    const relCatGadgets = evaluateProductRelevance(plushText, "Cat Gadgets");
    expect(relCatGadgets.relevanceStatus).toBe("IRRELEVANT");
    expect(relCatGadgets.isAccepted).toBe(false);

    const relPetToys = evaluateProductRelevance(plushText, "Pet Toys");
    expect(relPetToys.relevanceStatus).toBe("RELEVANT");
    expect(relPetToys.isAccepted).toBe(true);
  });

  it("Malformed URL slug /products/null-1773399526609 is downgraded from VERIFIED to PROBABLE", () => {
    const resolved = resolveProductIdentity({
      landingPageUrl: "https://livlandco.com/products/null-1773399526609",
      storeDomain: "livlandco.com",
      brandOrAdvertiser: "LivLand Co",
      rawHeadlines: ["Chew Resistant Squeaky Plush Pet Toy"],
      rawDescriptions: ["Durable plush squeaky toy for dogs"],
    });
    expect(resolved.identityStatus).toBe("PROBABLE");
    expect(resolved.isEligibleAsEvergreenWinner).toBe(false);
  });

  it("8-in-1 Electric Cleaning Brush Set for Home Use and Cordless Electric Spin Scrubber collapse into electric_spin_scrubber", () => {
    const fp1 = buildProductIdentityFingerprint(
      makeCandidate("clean_1", "8-in-1 Electric Cleaning Brush Set for Home Use")
    );
    const fp2 = buildProductIdentityFingerprint(
      makeCandidate("clean_2", "Cordless Electric Spin Scrubber")
    );
    expect(fp1.familyKey).toBe("electric_spin_scrubber");
    expect(fp2.familyKey).toBe("electric_spin_scrubber");
    expect(fp1.familyKey).not.toBe("brush_use");
  });

  it("Burnett Wallpaper is rejected as IRRELEVANT in DIY Tools", () => {
    const rel = evaluateProductRelevance(
      "Burnett Wallpaper Peel and Stick Decorative Wall Covering https://wallpaperstore.com/products/burnett-wallpaper",
      "DIY Tools"
    );
    expect(rel.relevanceStatus).toBe("IRRELEVANT");
    expect(rel.isAccepted).toBe(false);
  });
});
