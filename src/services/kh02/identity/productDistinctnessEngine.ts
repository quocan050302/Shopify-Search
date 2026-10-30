/**
 * SWAI KH-02 V12.4.3 — Unified Product Distinctness & Product Family Engine
 *
 * Provides a single authoritative identity & distinctness engine across:
 * - Candidate consolidation (discoverProductCandidatesFromAds / enrichProductCandidatesWithEvidence)
 * - Research Shortlist selection (selectTopResearchShortlist)
 * - Verified Evergreen Top 3 selection (runEvergreenProductResearch)
 * - Persisted snapshots & acceptance evaluation
 *
 * Enforces Section 5:
 * - 5.1: 6-level hierarchy:
 *        (A) Observation / Ad Creative
 *        (B) Merchant Listing
 *        (C) Actual Product / Model
 *        (D) Variant
 *        (E) Product Family
 *        (F) Distinct Research Opportunity
 * - 5.2: Strong evidence priority (Same canonical product URL, same merchant + merchantProductId,
 *        same verified GTIN, same verified brand + model; local SKU is strictly merchant-scoped).
 * - 5.3: Semantic similarity + physical specs/capacity/model comparison without false-merging distinct models
 *        or false-splitting identical products with different ad titles.
 * - 5.4: URL normalization with redirect/shortlink resolution, collection-linked product path normalization,
 *        and base product vs variant separation.
 * - 5.5: Explicit uncertainty tracking for unknown cross-merchant relationships in the same product family.
 * - 5.6: Niche-intent-aware opportunity selection (BROAD_CATEGORY prioritizes distinct product families;
 *        SPECIFIC_PRODUCT allows verified distinct models in the same family and labels them as alternatives).
 * - 5.7: Full structured decision evidence for every merge/separate evaluation.
 */

import { extractProductUrlMetadata } from "./productMetadataExtractor";
import { classifyAdvertisingHeadline } from "./adHeadlineClassifier";

export interface DistinctnessCandidateLike {
  candidateId: string;
  title?: string;
  displayName?: string;
  canonicalProductName?: string | null;
  canonicalProductUrl?: string | null;
  normalizedProductUrl?: string | null;
  resolvedFinalUrl?: string | null;
  declaredCanonicalUrl?: string | null;
  requestedUrl?: string | null;
  landingPageUrl?: string | null;
  storeDomain?: string | null;
  merchantDomain?: string | null;
  productHandle?: string | null;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  gtin?: string | null;
  merchantProductId?: string | null;
  variantId?: string | null;
  category?: string | null;
  matchedArchetypeId?: string | null;
  identityStatus?: "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "UNRESOLVED";
  supportingAdIds?: string[];
  sourceObservations?: Array<{
    sourceRecordId?: string;
    landingPageUrl?: string | null;
    sourceUrl?: string | null;
    title?: string | null;
  }>;
}

export interface ProductIdentityFingerprint {
  candidateId: string;
  observationKeys: string[];
  listingKey: string;
  productKey: string;
  variantKey: string | null;
  variantId?: string | null;
  rawSku?: string | null;
  identityStatus?: "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "UNRESOLVED";
  familyKey: string;
  familyLabel: string;
  normalizedCanonicalUrl: string | null;
  normalizedDomain: string | null;
  productHandle: string | null;
  merchantScopedProductId: string | null;
  merchantScopedSku: string | null;
  verifiedGtin: string | null;
  normalizedBrand: string | null;
  normalizedModel: string | null;
  physicalSpecs: {
    capacity: string | null;
    dimensions: string | null;
    packCount: string | null;
  };
  coreProductHeadNoun: string;
  normalizedProductTokens: string[];
  normalizedCleanTitle: string;
  hasStrongProductIdentifier: boolean;
}

export type PairwiseIdentityDecision =
  | "SAME_LISTING_SAME_PRODUCT"
  | "SAME_PRODUCT_DIFFERENT_VARIANT"
  | "SAME_MERCHANT_PRODUCT_ID"
  | "SAME_PRODUCT_CROSS_MERCHANT"
  | "SAME_PRODUCT_MODEL"
  | "SAME_MERCHANT_SAME_PRODUCT_NAME"
  | "DIFFERENT_MODELS_SAME_FAMILY"
  | "UNKNOWN_CROSS_MERCHANT_SAME_FAMILY"
  | "DIFFERENT_PRODUCTS_SAME_FAMILY"
  | "DIFFERENT_PRODUCTS";

export interface PairwiseIdentityComparison {
  candidateIds: [string, string];
  listingKeys: [string, string];
  productKeys: [string, string];
  familyKeys: [string, string];
  decision: PairwiseIdentityDecision;
  areSameListing: boolean;
  areSameActualProduct: boolean | null; // null when UNKNOWN_CROSS_MERCHANT_SAME_FAMILY
  areSameVariant: boolean;
  areSameFamily: boolean;
  areDistinctOpportunitiesForBroadNiche: boolean;
  areDistinctOpportunitiesForSpecificQuery: boolean;
  confidence: "EXACT" | "HIGH_CONFIDENCE" | "PROBABLE" | "AMBIGUOUS";
  uncertainty: string | null;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  reason: string;
}

export interface ProductFamilyRule {
  familyKey: string;
  familyLabel: string;
  headNoun: string;
  pattern: RegExp;
}

const PRODUCT_FAMILY_RULES: ProductFamilyRule[] = [
  // Kitchen
  {
    familyKey: "oil_dispenser_sprayer",
    familyLabel: "Oil Dispenser & Sprayer Bottle",
    headNoun: "oil_dispenser",
    pattern: /\b(oil\s+(?:sprayer|spray|dispenser|bottle|pourer|mister)|olive\s+oil\s+(?:sprayer|dispenser|bottle)|spray\s+and\s+pour\s+bottle)\b/i,
  },
  {
    familyKey: "vegetable_food_chopper",
    familyLabel: "Vegetable & Food Chopper / Slicer",
    headNoun: "chopper_slicer",
    pattern: /\b(vegetable\s+chopper|onion\s+chopper|food\s+chopper|garlic\s+chopper|mandoline\s+slicer|veggie\s+dicer|vegetable\s+slicer)\b/i,
  },
  {
    familyKey: "rotary_cheese_grater",
    familyLabel: "Rotary Grater & Shredder",
    headNoun: "grater",
    pattern: /\b(rotary\s+(?:cheese\s+)?grater|cheese\s+shredder|drum\s+grater)\b/i,
  },
  {
    familyKey: "sink_strainer_catcher",
    familyLabel: "Kitchen Sink Strainer & Drain Catcher",
    headNoun: "sink_strainer",
    pattern: /\b(sink\s+strainer|drain\s+(?:strainer|catcher|basket)|swan\s+sink|food\s+catcher)\b/i,
  },
  {
    familyKey: "food_vacuum_sealer",
    familyLabel: "Food Vacuum Sealer",
    headNoun: "vacuum_sealer",
    pattern: /\b(vacuum\s+sealer|food\s+sealer|bag\s+sealer)\b/i,
  },
  {
    familyKey: "knife_sharpener",
    familyLabel: "Knife Sharpener",
    headNoun: "knife_sharpener",
    pattern: /\b(knife\s+sharpener|rolling\s+sharpener|blade\s+sharpener)\b/i,
  },
  {
    familyKey: "air_fryer_accessory",
    familyLabel: "Air Fryer Liner & Rack",
    headNoun: "air_fryer_liner",
    pattern: /\b(air\s+fryer\s+(?:liner|liners|pot|basket|rack|mat))\b/i,
  },
  {
    familyKey: "cutting_board_defroster",
    familyLabel: "Cutting Board & Defrosting Tray",
    headNoun: "cutting_board",
    pattern: /\b(cutting\s+board|chopping\s+board|defrosting\s+tray)\b/i,
  },
  // Pet
  {
    familyKey: "pet_hair_remover_roller",
    familyLabel: "Pet Hair & Fur Remover Roller/Scraper",
    headNoun: "hair_remover",
    pattern: /\b(pet\s+hair(?:[\s\/_-]+(?:lint|dust|fur))*[\s\/_-]+(?:remover|roller|cleaner|scraper)|fur\s+(?:remover|roller|zapper)|chomchom|lint\s+roller\s+for\s+pet|uproot\s+clean(?:er)?)\b/i,
  },
  {
    familyKey: "pet_grooming_vacuum_clipper",
    familyLabel: "Pet Grooming Vacuum & Clipper Kit",
    headNoun: "grooming_vacuum",
    pattern: /\b((?:dog|pet|cat)\s+grooming\s+vacuum|grooming\s+vacuum\s+kit|pet\s+hair\s+vacuum)\b/i,
  },
  {
    familyKey: "pet_grooming_glove_brush",
    familyLabel: "Pet Grooming Glove & Deshedding Brush",
    headNoun: "grooming_brush",
    pattern: /\b(grooming\s+gloves?|deshedding\s+(?:brush|glove|tool)|undercoat\s+rake|slicker\s+brush|steam\s+pet\s+brush|pet\s+grooming\s+(?:comb|brush))\b/i,
  },
  {
    familyKey: "pet_water_fountain",
    familyLabel: "Automatic Pet Water Fountain",
    headNoun: "water_fountain",
    // V12.4.3.3.1 G12 fix: Extended to match "wireless fountain", "stainless steel water fountain",
    // "pet drinking fountain", and brand-prefixed variants such as "KittySpout Wireless Fountain"
    // and "Pawira Stainless Steel Water Fountain".
    pattern:
      /\b((?:cat|dog|pet)\s+(?:water\s+)?fountain|water\s+fountain(?:\s+for\s+(?:cats|dogs|pets))?|drinking\s+fountain(?:\s+for\s+(?:cats|dogs|pets))?|wireless\s+(?:pet\s+)?fountain|stainless\s+steel\s+(?:pet\s+|water\s+)?fountain|fountain\s+(?:water|pump|filter)|pet\s+drinking\s+(?:water\s+)?fountain)\b/i,
  },
  {
    familyKey: "automatic_pet_feeder",
    familyLabel: "Automatic Pet Feeder",
    headNoun: "pet_feeder",
    pattern: /\b((?:automatic|smart|timed)\s+(?:pet|cat|dog)\s+feeder|(?:pet|cat|dog)\s+food\s+dispenser|automatic\s+feeder)\b/i,
  },
  {
    familyKey: "gps_pet_tracker_collar",
    familyLabel: "GPS Pet Tracker & Smart Collar",
    headNoun: "pet_tracker",
    pattern: /\b(gps\s+(?:pet|dog|cat)\s+tracker|(?:pet|dog|cat)\s+gps\s+(?:tracker|collar)|smart\s+pet\s+tracker)\b/i,
  },
  {
    familyKey: "bark_deterrent_whistle",
    familyLabel: "Anti-Barking Deterrent & Dog Whistle",
    headNoun: "bark_deterrent",
    pattern: /\b(anti[-_\s]?bark(?:ing)?\s+(?:device|collar|deterrent)|bark\s+(?:collar|control|deterrent)|dog\s+whistle)\b/i,
  },
  {
    familyKey: "pet_nail_grinder_clipper",
    familyLabel: "Pet Nail Grinder & Trimmer",
    headNoun: "nail_grinder",
    pattern: /\b((?:dog|cat|pet)\s+nail\s+(?:grinder|trimmer|clipper)|nail\s+grinder)\b/i,
  },
  {
    familyKey: "cat_litter_box_mat",
    familyLabel: "Cat Litter Box & Litter Trapping Mat",
    headNoun: "litter_box",
    pattern: /\b(litter\s+box|litter\s+mat|cat\s+litter\s+(?:scoop|deodorizer|box|mat))\b/i,
  },
  {
    familyKey: "pet_bed_calming",
    familyLabel: "Orthopedic & Calming Pet Bed",
    headNoun: "pet_bed",
    pattern: /\b((?:dog|cat|pet)\s+bed|calming\s+bed|orthopedic\s+pet\s+bed)\b/i,
  },
  {
    familyKey: "pet_car_seat_harness",
    familyLabel: "Pet Car Seat Cover & Safety Harness",
    headNoun: "pet_car_harness",
    pattern: /\b(pet\s+car\s+(?:seat|harness|hammock)|dog\s+(?:car\s+seat|seat\s+belt|harness)|no[-_\s]pull\s+harness)\b/i,
  },
  {
    familyKey: "interactive_pet_toy",
    familyLabel: "Interactive Pet Toy & Ball Launcher",
    headNoun: "pet_toy",
    pattern: /\b(ball\s+launcher|interactive\s+(?:dog|cat|pet)\s+toy|chew\s+toy|catnip\s+toy|rolling\s+ball\s+toy|lick\s+mat)\b/i,
  },
  // DIY & Home Improvement
  {
    familyKey: "hot_glue_gun",
    familyLabel: "Cordless & Hot Melt Glue Gun",
    headNoun: "glue_gun",
    pattern: /\b((?:hot\s+)?glue\s+gun|glue\s+pen)\b/i,
  },
  {
    familyKey: "decorative_switch_plate",
    familyLabel: "Decorative Switch Plate & Outlet Cover",
    headNoun: "switch_plate",
    pattern: /\b(switch\s+(?:plate|cover|sticker)s?|outlet\s+(?:plate|cover)s?|wall\s+plate\s+cover)\b/i,
  },
  {
    familyKey: "wood_furniture_repair_marker",
    familyLabel: "Wood & Furniture Scratch Repair Kit",
    headNoun: "repair_marker",
    pattern: /\b(scratch\s+repair|wood\s+(?:repair|filler|marker)s?|furniture\s+(?:repair|touch\s+up))\b/i,
  },
  {
    familyKey: "wall_tile_repair_paste",
    familyLabel: "Wall Mending & Tile Grout Repair",
    headNoun: "wall_repair",
    pattern: /\b(wall\s+(?:repair|mending|patch)|drywall\s+(?:patch|repair)|tile\s+(?:repair|grout\s+pen)|caulking\s+tool)\b/i,
  },
  {
    familyKey: "woodworking_jig_clamp",
    familyLabel: "Pocket Hole Jig & Corner Clamp",
    headNoun: "woodworking_jig",
    pattern: /\b(pocket\s+hole\s+jig|corner\s+clamp|dowel\s+jig|drill\s+guide|contour\s+gauge)\b/i,
  },
  {
    familyKey: "laser_level_measure",
    familyLabel: "Laser Level & Precision Measuring Tool",
    headNoun: "laser_level",
    pattern: /\b(laser\s+level|cross\s+line\s+laser|stud\s+finder|digital\s+level|angle\s+finder|laser\s+measure)\b/i,
  },
  {
    familyKey: "magnetic_wristband_tool_holder",
    familyLabel: "Magnetic Tool Wristband & Bit Holder",
    headNoun: "magnetic_wristband",
    pattern: /\b(magnetic\s+wristband|tool\s+wristband|magnetic\s+bit\s+holder|right\s+angle\s+drill)\b/i,
  },
  {
    familyKey: "paint_edger_roller",
    familyLabel: "Paint Edger & Trim Roller Brush",
    headNoun: "paint_edger",
    pattern: /\b(paint\s+edger|paint\s+roller|trim\s+brush|paint\s+sprayer)\b/i,
  },
  {
    familyKey: "precision_craft_cutter",
    familyLabel: "Precision Craft Cutter & Rotary Tool",
    headNoun: "craft_cutter",
    pattern: /\b(craft\s+cutter|rotary\s+(?:tool|cutter)|mini\s+drill|engraving\s+pen)\b/i,
  },
  {
    familyKey: "peel_and_stick_wall_tile",
    familyLabel: "Peel-and-Stick Wall Tile & Panel",
    headNoun: "wall_tile",
    pattern: /\b(peel\s+and\s+stick\s+(?:wall|tile|backsplash|floor)|3d\s+wall\s+panel|wallpaper)\b/i,
  },
  // Gardening
  {
    familyKey: "self_watering_plant_spike",
    familyLabel: "Self-Watering Plant Spike & Drip Irrigator",
    headNoun: "watering_spike",
    pattern: /\b(watering\s+(?:spike|globe)s?|plant\s+spikes?|drip\s+irrigation)\b/i,
  },
  {
    familyKey: "pruning_shears_secateurs",
    familyLabel: "Garden Pruning Shears & Secateurs",
    headNoun: "pruning_shears",
    pattern: /\b(pruning\s+shears?|garden\s+shears?|secateurs|branch\s+cutter|loppers)\b/i,
  },
  {
    familyKey: "seed_starter_tray",
    familyLabel: "Seed Starter Tray & Grow Dome",
    headNoun: "seed_tray",
    pattern: /\b(seed\s+starter|seedling\s+tray|germination\s+tray)\b/i,
  },
  {
    familyKey: "plant_support_trellis",
    familyLabel: "Plant Support Clips & Trellis",
    headNoun: "plant_trellis",
    pattern: /\b(plant\s+(?:support|clips|trellis)|garden\s+trellis)\b/i,
  },
  {
    familyKey: "weed_puller_tool",
    familyLabel: "Stand-Up Weed Puller & Weeding Tool",
    headNoun: "weed_puller",
    pattern: /\b(weed\s+puller|weeding\s+tool|dandelion\s+puller)\b/i,
  },
  // Cleaning
  {
    familyKey: "electric_spin_scrubber",
    familyLabel: "Electric Spin Scrubber & Power Brush",
    headNoun: "spin_scrubber",
    pattern: /\b(spin\s+scrubber|power\s+scrubber|cleaning\s+brush\s+electric)\b/i,
  },
  {
    familyKey: "spray_microfiber_mop",
    familyLabel: "Spray Mop & Spin Mop System",
    headNoun: "spray_mop",
    pattern: /\b(spray\s+mop|microfiber\s+mop|spin\s+mop|flat\s+mop)\b/i,
  },
  {
    familyKey: "washing_machine_cleaner",
    familyLabel: "Washing Machine & Appliance Cleaner Tablets",
    headNoun: "appliance_cleaner",
    pattern: /\b(washing\s+machine\s+cleaner|dishwasher\s+cleaner|washer\s+tablets)\b/i,
  },
  {
    familyKey: "cordless_vacuum_cleaner",
    familyLabel: "Cordless Stick & Handheld Vacuum Cleaner",
    headNoun: "vacuum_cleaner",
    pattern: /\b(cordless\s+(?:stick\s+)?vacuum|stick\s+vacuum|handheld\s+vacuum|vacuum\s+cleaner)\b/i,
  },
  {
    familyKey: "robot_vacuum_cleaner",
    familyLabel: "Robot Vacuum & Floor Cleaner",
    headNoun: "robot_vacuum",
    pattern: /\b(robot\s+vacuum|robotic\s+vacuum)\b/i,
  },
  {
    familyKey: "steam_cleaner_mop",
    familyLabel: "Steam Cleaner & Handheld Steamer",
    headNoun: "steam_cleaner",
    pattern: /\b(steam\s+cleaner|steam\s+mop|handheld\s+steamer)\b/i,
  },
  {
    familyKey: "portable_carpet_spot_cleaner",
    familyLabel: "Portable Carpet & Upholstery Spot Cleaner",
    headNoun: "carpet_cleaner",
    pattern: /\b(carpet\s+cleaner|spot\s+cleaner|upholstery\s+cleaner)\b/i,
  },
  {
    familyKey: "window_cleaning_tool",
    familyLabel: "Magnetic Window Cleaner & Window Vacuum",
    headNoun: "window_cleaner",
    pattern: /\b(window\s+(?:cleaner|vacuum|squeegee)|magnetic\s+window)\b/i,
  },
  {
    familyKey: "lint_fabric_shaver",
    familyLabel: "Electric Lint Remover & Fabric Shaver",
    headNoun: "fabric_shaver",
    pattern: /\b(lint\s+remover|fabric\s+shaver|sweater\s+defuzzer)\b/i,
  },
  // Car & Automotive Accessories
  {
    familyKey: "car_phone_mount",
    familyLabel: "Magnetic & MagSafe Car Phone Mount",
    headNoun: "car_phone_mount",
    pattern: /\b(car\s+phone\s+(?:mount|holder)|magnetic\s+(?:car\s+)?phone\s+(?:mount|holder)|dashboard\s+phone\s+(?:mount|holder)|vent\s+phone\s+mount)\b/i,
  },
  {
    familyKey: "car_organizer_storage",
    familyLabel: "Car Trunk & Seat Organizer Storage",
    headNoun: "car_organizer",
    pattern: /\b((?:car|trunk|seat|auto|vehicle|suvs?)\s+(?:trunk\s+|backseat\s+|seat\s+)?organizer|seat\s+gap\s+filler|car\s+storage\s+box|trunk\s+storage)\b/i,
  },
  {
    familyKey: "portable_car_vacuum",
    familyLabel: "Portable High-Power Car Vacuum",
    headNoun: "car_vacuum",
    pattern: /\b(car\s+vacuum|automotive\s+vacuum|vehicle\s+vacuum)\b/i,
  },
  {
    familyKey: "portable_tire_inflator",
    familyLabel: "Portable Tire Inflator & Air Compressor",
    headNoun: "tire_inflator",
    pattern: /\b(tire\s+inflator|car\s+air\s+compressor|portable\s+air\s+pump)\b/i,
  },
  {
    familyKey: "car_dash_cam",
    familyLabel: "Front & Rear Car Dash Cam",
    headNoun: "dash_cam",
    pattern: /\b(dash\s*cam|car\s+camera|driving\s+recorder)\b/i,
  },
  {
    familyKey: "vehicle_paint_repair_kit",
    familyLabel: "Car Scratch & Paint Touch-Up Repair Kit",
    headNoun: "car_paint_repair",
    pattern: /\b((?:car|auto|vehicle)\s+(?:scratch|paint)\s+(?:repair|touch[-_\s]?up)|touch[-_\s]?up\s+paint|car\s+polish)\b/i,
  },
  {
    familyKey: "windshield_sunshade",
    familyLabel: "Foldable Car Windshield Sunshade",
    headNoun: "windshield_sunshade",
    pattern: /\b(windshield\s+sun\s*shade|car\s+sun\s*shade|car\s+umbrella\s+shade)\b/i,
  },
  {
    familyKey: "car_jump_starter",
    familyLabel: "Portable Car Battery Jump Starter",
    headNoun: "jump_starter",
    pattern: /\b(jump\s+starter|car\s+battery\s+booster)\b/i,
  },
  // Home Decor
  {
    familyKey: "rechargeable_wall_sconce",
    familyLabel: "Rechargeable Wall Sconce & Accent Lamp",
    headNoun: "wall_sconce",
    pattern: /\b(wall\s+sconce|crystal\s+lamp|sunset\s+lamp|table\s+lamp|night\s+light)\b/i,
  },
  {
    familyKey: "stretch_sofa_slipcover",
    familyLabel: "Stretch Sofa Cover & Couch Slipcover",
    headNoun: "sofa_cover",
    pattern: /\b(sofa\s+(?:cover|slipcover)|couch\s+cover|cushion\s+cover)\b/i,
  },
];

const GENERIC_TOKENS_FOR_FINGERPRINT = new Set([
  "the", "and", "for", "with", "your", "our", "from", "that", "this",
  "new", "best", "pro", "kit", "set", "pack", "edition", "original",
  "official", "premium", "smart", "portable", "electric", "automatic",
  "rechargeable", "cordless", "wireless", "mini", "ultra", "home",
  "kitchen", "routine", "useful", "gift", "cook", "cooking", "house",
  "pet", "dog", "cat", "puppy", "kitten", "diy", "garden", "gardening",
  "cleaning", "decor", "store", "shop", "buy", "sale", "free", "shipping",
  "item", "items", "deal", "deals", "product", "products", "amazing",
  "in", "to", "of", "on", "by", "at", "an", "a",
  "blue", "red", "black", "white", "green", "pink", "gray", "grey", "silver", "gold",
]);

function stripVariantHandleSuffixes(handle: string | null | undefined): string | null {
  if (!handle) return null;
  let cleaned = handle.toLowerCase().trim();
  // Repeatedly strip trailing color / pack / size variant suffixes on the same merchant handle
  let prev = "";
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(
      /[-_](?:blue|red|black|white|green|pink|gray|grey|silver|gold|purple|yellow|orange|brown|beige|small|medium|large|xl|xxl|\d+[-_]?pack|\d+[-_]?pcs|\d+[-_]?count)$/i,
      ""
    );
  }
  return cleaned || handle.toLowerCase().trim();
}

function normalizeBrandName(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const cleaned = brand
    .toLowerCase()
    .replace(/\b(official|store|shop|direct|inc|llc|ltd|co)\b/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (!cleaned || cleaned.length < 2 || ["unknown", "generic", "meta", "facebook", "shopify"].includes(cleaned)) {
    return null;
  }
  return cleaned;
}

function normalizeModelCode(
  explicitModel: string | null | undefined,
  titleText: string
): string | null {
  if (explicitModel && explicitModel.trim()) {
    const m = explicitModel.trim();
    if (!/^(ad|fb|ig|tt|lp|camp|test|var|wmt|gg)\d+/i.test(m)) {
      return m.toUpperCase().replace(/\s+/g, "-");
    }
  }

  // Look for explicit model patterns in title, e.g. "Model X90", "CP-100", "X200", "V3", "4G"
  const explicitMatch = titleText.match(
    /\b(?:model\s*[:#-]?\s*)?([A-Za-z]{1,4}-\d{2,5}[A-Za-z]?|[A-Za-z]{1,3}\d{2,4}[A-Za-z]?|\bV\d{1,2}\b|\b4G\b|\b5G\b)/i
  );
  if (explicitMatch && explicitMatch[1]) {
    const token = explicitMatch[1].toUpperCase();
    // Do not confuse capacities like 500ML or 16OZ with model codes
    if (!/^\d+(ML|OZ|LB|KG|MM|CM|IN|FT|PC|PCS|PACK|W|V|MAH)$/i.test(token)) {
      if (!/^(AD|FB|IG|TT|LP|WMT|GG)\d+/i.test(token)) {
        return token;
      }
    }
  }
  return null;
}

function extractPhysicalSpecs(text: string): {
  capacity: string | null;
  dimensions: string | null;
  packCount: string | null;
} {
  const capMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:ml|oz|fl\s*oz|l|liter|litre|gal|gallon))\b/i);
  const dimMatch = text.match(/\b(\d+(?:\.\d+)?\s*(?:mm|cm|inch|in|ft)\b)/i);
  const packMatch = text.match(/\b(\d+\s*(?:pack|pcs|pieces|count|set\s+of\s+\d+))\b/i);

  // Normalize capacity to ml when possible for comparison (e.g. 16oz/470ml -> 470ml)
  let capacity: string | null = null;
  const mlExplicit = text.match(/\b(\d{2,4})\s*ml\b/i);
  if (mlExplicit) {
    capacity = `${mlExplicit[1]}ml`;
  } else if (capMatch) {
    capacity = capMatch[1].toLowerCase().replace(/\s+/g, "");
  }

  return {
    capacity,
    dimensions: dimMatch ? dimMatch[1].toLowerCase().replace(/\s+/g, "") : null,
    packCount: packMatch ? packMatch[1].toLowerCase().replace(/\s+/g, "") : null,
  };
}

export function resolveProductFamily(
  text: string,
  categoryHint?: string | null,
  archetypeHint?: string | null
): { familyKey: string; familyLabel: string; headNoun: string } {
  const normalizedText = text.replace(/[\/_-]+/g, " ").trim();
  for (const rule of PRODUCT_FAMILY_RULES) {
    if (rule.pattern.test(normalizedText)) {
      return {
        familyKey: rule.familyKey,
        familyLabel: rule.familyLabel,
        headNoun: rule.headNoun,
      };
    }
  }

  if (archetypeHint && archetypeHint.trim()) {
    const cleanArch = archetypeHint.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    return {
      familyKey: cleanArch,
      familyLabel: archetypeHint.trim(),
      headNoun: cleanArch,
    };
  }

  // V12.4.3.3.1 G12 fix: Token-based fallback only applied when at least 2 meaningful semantic tokens
  // survive the filter.  Single-token results (e.g. a brand name alone) produce UNRESOLVED_FAMILY
  // rather than a spurious "brand_name"-style key that would count as a distinct family.
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        w !== "model" &&
        w !== "sku" &&
        w !== "version" &&
        !GENERIC_TOKENS_FOR_FINGERPRINT.has(w) &&
        !/^\d+/.test(w) &&
        !/^[a-z]{1,4}\d{1,5}[a-z]?$/i.test(w)
    );

  // Require at least 2 meaningful tokens for a reliable composite family key.
  // Single-token or zero-token results signal insufficient semantic confidence.
  if (tokens.length < 2) {
    return {
      familyKey: "unresolved_family",
      familyLabel: "Unresolved Product Family",
      headNoun: tokens[0] || "unresolved",
    };
  }

  const headNoun = tokens[tokens.length - 1];
  const modifier = tokens[tokens.length - 2];
  const familyKey = `${modifier}_${headNoun}`;

  return {
    familyKey,
    familyLabel: `${modifier} ${headNoun}`.replace(/\b\w/g, (c) => c.toUpperCase()),
    headNoun,
  };
}

/**
 * Builds a structured multi-level identity fingerprint for a product candidate (Section 5.1–5.4).
 */
export function buildProductIdentityFingerprint(
  candidate: DistinctnessCandidateLike | ProductIdentityFingerprint
): ProductIdentityFingerprint {
  if (
    candidate &&
    typeof (candidate as ProductIdentityFingerprint).listingKey === "string" &&
    typeof (candidate as ProductIdentityFingerprint).productKey === "string" &&
    typeof (candidate as ProductIdentityFingerprint).familyKey === "string" &&
    Array.isArray((candidate as ProductIdentityFingerprint).normalizedProductTokens)
  ) {
    return candidate as ProductIdentityFingerprint;
  }

  const cand = candidate as DistinctnessCandidateLike;
  const rawTitle =
    cand.canonicalProductName ||
    cand.displayName ||
    cand.title ||
    "";
  const cls = classifyAdvertisingHeadline(rawTitle);
  const cleanTitle = cls.cleanTitle || rawTitle.trim();

  // Resolve best canonical URL across all available URL fields (including resolved redirects)
  const candidateUrls = [
    cand.normalizedProductUrl,
    cand.declaredCanonicalUrl,
    cand.resolvedFinalUrl,
    cand.canonicalProductUrl,
    cand.landingPageUrl,
    cand.requestedUrl,
    ...(cand.sourceObservations || []).map(
      (o) => o.landingPageUrl || o.sourceUrl || null
    ),
  ].filter((u): u is string => Boolean(u && typeof u === "string"));

  let bestUrlMeta = extractProductUrlMetadata(candidateUrls[0] || null);
  for (const u of candidateUrls) {
    const meta = extractProductUrlMetadata(u);
    if (meta.isShopifyProductUrl && meta.normalizedBaseProductUrl) {
      bestUrlMeta = meta;
      break;
    }
    if (meta.isValidEcommerceUrl && !bestUrlMeta.isValidEcommerceUrl) {
      bestUrlMeta = meta;
    }
  }

  const normalizedCanonicalUrl =
    bestUrlMeta.normalizedBaseProductUrl ||
    bestUrlMeta.cleanCanonicalUrl ||
    null;

  const rawDomain = cand.storeDomain || cand.merchantDomain || null;
  const normalizedDomain =
    bestUrlMeta.storeDomain ||
    (rawDomain
      ? rawDomain.replace(/^www\./i, "").toLowerCase().trim()
      : null);

  const productHandle = bestUrlMeta.productHandle || cand.productHandle || null;
  const variantId =
    cand.variantId || bestUrlMeta.variantId || null;

  const merchantScopedProductId =
    normalizedDomain && (cand.merchantProductId || bestUrlMeta.queryProductId)
      ? `${normalizedDomain}::pid::${String(
          cand.merchantProductId || bestUrlMeta.queryProductId
        )
          .trim()
          .toLowerCase()}`
      : null;

  const rawSku = cand.sku || bestUrlMeta.skuFromQuery || null;
  const merchantScopedSku =
    normalizedDomain && rawSku
      ? `${normalizedDomain}::sku::${String(rawSku)
          .trim()
          .toLowerCase()}`
      : null;

  const rawGtin = cand.gtin ? String(cand.gtin).replace(/[^0-9]/g, "") : "";
  const verifiedGtin = rawGtin.length >= 8 && rawGtin.length <= 14 ? rawGtin : null;

  const normalizedBrand = normalizeBrandName(cand.brand);
  const normalizedModel = normalizeModelCode(
    cand.model || cls.extractedModelOrSku || bestUrlMeta.modelFromQuery,
    rawTitle
  );

  const physicalSpecs = extractPhysicalSpecs(rawTitle);
  const familyInfo = resolveProductFamily(
    rawTitle,
    cand.category,
    cand.matchedArchetypeId
  );

  const normalizedProductTokens = Array.from(
    new Set(
      cleanTitle
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (w) =>
            w.length >= 3 &&
            !GENERIC_TOKENS_FOR_FINGERPRINT.has(w) &&
            !/^\d+(?:ml|oz|mm|cm|in|pc|pcs)?$/i.test(w)
        )
    )
  ).sort();

  const observationKeys = Array.from(
    new Set([
      ...(cand.supportingAdIds || []),
      ...(cand.sourceObservations || [])
        .map((o) => o.sourceRecordId)
        .filter((x): x is string => Boolean(x)),
    ])
  );

  // Level B: Listing Key (specific to merchant + URL or merchantProductId)
  const listingKey =
    normalizedCanonicalUrl
      ? `url::${normalizedCanonicalUrl.toLowerCase()}`
      : merchantScopedProductId
      ? merchantScopedProductId
      : normalizedDomain
      ? `domain_title::${normalizedDomain}::${cleanTitle.toLowerCase()}`
      : `unlinked::${cand.candidateId}`;

  // Level C: Actual Product Key
  let productKey: string;
  let hasStrongProductIdentifier = false;

  if (verifiedGtin) {
    productKey = `gtin::${verifiedGtin}`;
    hasStrongProductIdentifier = true;
  } else if (normalizedBrand && normalizedModel) {
    productKey = `brand_model::${normalizedBrand}::${normalizedModel.toLowerCase()}`;
    hasStrongProductIdentifier = true;
  } else if (normalizedModel && familyInfo.familyKey) {
    productKey = `family_model::${familyInfo.familyKey}::${normalizedModel.toLowerCase()}`;
    hasStrongProductIdentifier = true;
  } else if (merchantScopedProductId) {
    productKey = merchantScopedProductId;
    hasStrongProductIdentifier = true;
  } else if (normalizedCanonicalUrl && bestUrlMeta.isShopifyProductUrl) {
    productKey = `url::${normalizedCanonicalUrl.toLowerCase()}`;
    hasStrongProductIdentifier = true;
  } else if (merchantScopedSku) {
    productKey = merchantScopedSku;
    hasStrongProductIdentifier = true;
  } else if (normalizedDomain && normalizedProductTokens.length >= 2) {
    productKey = `merchant_tokens::${normalizedDomain}::${familyInfo.familyKey}::${normalizedProductTokens.join("_")}`;
  } else if (normalizedProductTokens.length >= 2) {
    productKey = `title_tokens::${familyInfo.familyKey}::${normalizedProductTokens.join("_")}`;
  } else {
    productKey = `candidate::${cand.candidateId}`;
  }

  const variantKey = variantId ? `${productKey}::variant::${variantId}` : null;

  return {
    candidateId: cand.candidateId,
    observationKeys,
    listingKey,
    productKey,
    variantKey,
    variantId,
    rawSku: rawSku ? String(rawSku) : null,
    identityStatus: cand.identityStatus,
    familyKey: familyInfo.familyKey,
    familyLabel: familyInfo.familyLabel,
    normalizedCanonicalUrl,
    normalizedDomain,
    productHandle,
    merchantScopedProductId,
    merchantScopedSku,
    verifiedGtin,
    normalizedBrand,
    normalizedModel,
    physicalSpecs,
    coreProductHeadNoun: familyInfo.headNoun,
    normalizedProductTokens,
    normalizedCleanTitle: cleanTitle,
    hasStrongProductIdentifier,
  };
}

function computeTokenJaccard(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) {
      intersection++;
    } else {
      // Check singular/plural match
      const stem = t.endsWith("s") ? t.slice(0, -1) : `${t}s`;
      if (setB.has(stem)) intersection++;
    }
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compares two product candidates across all 6 identity levels with explicit supporting
 * and conflicting evidence (Sections 5.1–5.7).
 */
export function compareProductIdentity(
  candA: DistinctnessCandidateLike | ProductIdentityFingerprint,
  candB: DistinctnessCandidateLike | ProductIdentityFingerprint
): PairwiseIdentityComparison {
  const fpA = buildProductIdentityFingerprint(candA);
  const fpB = buildProductIdentityFingerprint(candB);

  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const areSameFamily = fpA.familyKey === fpB.familyKey;

  // Check if both merchants have the same raw SKU string across DIFFERENT merchants
  const skuValA = (candA as DistinctnessCandidateLike).sku || fpA.rawSku || null;
  const skuValB = (candB as DistinctnessCandidateLike).sku || fpB.rawSku || null;
  const rawSkuA = skuValA ? String(skuValA).trim().toLowerCase() : null;
  const rawSkuB = skuValB ? String(skuValB).trim().toLowerCase() : null;
  if (
    rawSkuA &&
    rawSkuB &&
    rawSkuA === rawSkuB &&
    fpA.normalizedDomain &&
    fpB.normalizedDomain &&
    fpA.normalizedDomain !== fpB.normalizedDomain
  ) {
    conflictingEvidence.push(
      `Local SKU '${skuValA}' appears on two different merchant domains (${fpA.normalizedDomain} vs ${fpB.normalizedDomain}); local SKU strings are merchant-scoped and cannot prove cross-merchant identity without GTIN or verified brand+model.`
    );
  }

  const varA = (candA as DistinctnessCandidateLike).variantId || fpA.variantId || null;
  const varB = (candB as DistinctnessCandidateLike).variantId || fpB.variantId || null;

  // 1. Exact same normalized canonical product URL (includes resolved redirects & stripped tracking/collection paths)
  if (
    fpA.normalizedCanonicalUrl &&
    fpB.normalizedCanonicalUrl &&
    fpA.normalizedCanonicalUrl.toLowerCase() === fpB.normalizedCanonicalUrl.toLowerCase()
  ) {
    supportingEvidence.push(
      `Both candidates resolve to the exact same normalized product URL: ${fpA.normalizedCanonicalUrl}`
    );
    if (fpA.normalizedCleanTitle.toLowerCase() !== fpB.normalizedCleanTitle.toLowerCase()) {
      conflictingEvidence.push(
        `Different ad/display titles ('${fpA.normalizedCleanTitle}' vs '${fpB.normalizedCleanTitle}') overridden by identical canonical product URL.`
      );
    }

    const differentVariants = Boolean(
      varA && varB && varA !== varB
    );

    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [fpA.productKey, fpA.productKey],
      familyKeys: [fpA.familyKey, fpB.familyKey],
      decision: differentVariants
        ? "SAME_PRODUCT_DIFFERENT_VARIANT"
        : "SAME_LISTING_SAME_PRODUCT",
      areSameListing: true,
      areSameActualProduct: true,
      areSameVariant: !differentVariants,
      areSameFamily: true,
      areDistinctOpportunitiesForBroadNiche: false,
      areDistinctOpportunitiesForSpecificQuery: false,
      confidence: "EXACT",
      uncertainty: null,
      supportingEvidence,
      conflictingEvidence,
      reason: differentVariants
        ? `Same canonical product URL (${fpA.normalizedCanonicalUrl}) with different variant IDs (${candA.variantId} vs ${candB.variantId}).`
        : `Both candidates point to the exact same canonical product URL (${fpA.normalizedCanonicalUrl}).`,
    };
  }

  // 2. Same Merchant + Same Merchant Product ID or Merchant-Scoped SKU
  if (
    (fpA.merchantScopedProductId &&
      fpB.merchantScopedProductId &&
      fpA.merchantScopedProductId === fpB.merchantScopedProductId) ||
    (fpA.merchantScopedSku &&
      fpB.merchantScopedSku &&
      fpA.merchantScopedSku === fpB.merchantScopedSku)
  ) {
    const idUsed = fpA.merchantScopedProductId || fpA.merchantScopedSku!;
    supportingEvidence.push(`Same merchant and verified merchant identifier (${idUsed}).`);
    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [fpA.productKey, fpA.productKey],
      familyKeys: [fpA.familyKey, fpB.familyKey],
      decision: "SAME_MERCHANT_PRODUCT_ID",
      areSameListing: fpA.listingKey === fpB.listingKey,
      areSameActualProduct: true,
      areSameVariant: candA.variantId === candB.variantId,
      areSameFamily: true,
      areDistinctOpportunitiesForBroadNiche: false,
      areDistinctOpportunitiesForSpecificQuery: false,
      confidence: "EXACT",
      uncertainty: null,
      supportingEvidence,
      conflictingEvidence,
      reason: `Same merchant domain (${fpA.normalizedDomain}) and identical merchant product/SKU identifier (${idUsed}).`,
    };
  }

  // 3. Same Verified GTIN (even across different merchants)
  if (fpA.verifiedGtin && fpB.verifiedGtin) {
    if (fpA.verifiedGtin === fpB.verifiedGtin) {
      supportingEvidence.push(`Identical verified GTIN (${fpA.verifiedGtin}).`);
      return {
        candidateIds: [candA.candidateId, candB.candidateId],
        listingKeys: [fpA.listingKey, fpB.listingKey],
        productKeys: [fpA.productKey, fpA.productKey],
        familyKeys: [fpA.familyKey, fpB.familyKey],
        decision: "SAME_PRODUCT_CROSS_MERCHANT",
        areSameListing: fpA.listingKey === fpB.listingKey,
        areSameActualProduct: true,
        areSameVariant: true,
        areSameFamily: true,
        areDistinctOpportunitiesForBroadNiche: false,
        areDistinctOpportunitiesForSpecificQuery: false,
        confidence: "EXACT",
        uncertainty: null,
        supportingEvidence,
        conflictingEvidence,
        reason: `Both listings share verified global GTIN ${fpA.verifiedGtin}.`,
      };
    } else {
      conflictingEvidence.push(
        `Different verified GTINs (${fpA.verifiedGtin} vs ${fpB.verifiedGtin}).`
      );
    }
  }

  // 4. Explicit Model Comparison (Same vs Different Models)
  if (fpA.normalizedModel && fpB.normalizedModel) {
    if (
      fpA.normalizedModel === fpB.normalizedModel &&
      (areSameFamily ||
        (fpA.normalizedBrand && fpA.normalizedBrand === fpB.normalizedBrand))
    ) {
      supportingEvidence.push(
        `Both candidates specify model '${fpA.normalizedModel}'${
          fpA.normalizedBrand ? ` by brand '${fpA.normalizedBrand}'` : ""
        } in product family '${fpA.familyKey}'.`
      );
      return {
        candidateIds: [candA.candidateId, candB.candidateId],
        listingKeys: [fpA.listingKey, fpB.listingKey],
        productKeys: [fpA.productKey, fpA.productKey],
        familyKeys: [fpA.familyKey, fpB.familyKey],
        decision: "SAME_PRODUCT_MODEL",
        areSameListing: fpA.listingKey === fpB.listingKey,
        areSameActualProduct: true,
        areSameVariant: true,
        areSameFamily: true,
        areDistinctOpportunitiesForBroadNiche: false,
        areDistinctOpportunitiesForSpecificQuery: false,
        confidence: "HIGH_CONFIDENCE",
        uncertainty: null,
        supportingEvidence,
        conflictingEvidence,
        reason: `Both candidates refer to the same product model (${fpA.normalizedModel}) despite any title differences.`,
      };
    }

    if (fpA.normalizedModel !== fpB.normalizedModel && areSameFamily) {
      supportingEvidence.push(
        `Both belong to product family '${fpA.familyKey}' (${fpA.familyLabel}).`
      );
      conflictingEvidence.push(
        `Explicitly different product models: '${fpA.normalizedModel}' vs '${fpB.normalizedModel}'.`
      );
      return {
        candidateIds: [candA.candidateId, candB.candidateId],
        listingKeys: [fpA.listingKey, fpB.listingKey],
        productKeys: [fpA.productKey, fpB.productKey],
        familyKeys: [fpA.familyKey, fpB.familyKey],
        decision: "DIFFERENT_MODELS_SAME_FAMILY",
        areSameListing: false,
        areSameActualProduct: false,
        areSameVariant: false,
        areSameFamily: true,
        areDistinctOpportunitiesForBroadNiche: false,
        areDistinctOpportunitiesForSpecificQuery: true,
        confidence: "HIGH_CONFIDENCE",
        uncertainty: null,
        supportingEvidence,
        conflictingEvidence,
        reason: `Distinct verified models ('${fpA.normalizedModel}' vs '${fpB.normalizedModel}') within the same product family ('${fpA.familyLabel}'). Eligible as model alternatives for specific product queries, but share the same functional family for broad category diversity.`,
      };
    }
  }

  // Check if either candidate is an unresolved/unidentified ad without URL or strong identifier:
  // Never collapse distinct unidentified ads into a single candidate.
  const isUnresolvedA =
    candA.identityStatus === "UNRESOLVED" ||
    fpA.normalizedCleanTitle.startsWith("Unidentified Product");
  const isUnresolvedB =
    candB.identityStatus === "UNRESOLVED" ||
    fpB.normalizedCleanTitle.startsWith("Unidentified Product");
  if (
    (isUnresolvedA || isUnresolvedB) &&
    !fpA.normalizedCanonicalUrl &&
    !fpB.normalizedCanonicalUrl &&
    candA.candidateId !== candB.candidateId
  ) {
    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [`unresolved::${candA.candidateId}`, `unresolved::${candB.candidateId}`],
      familyKeys: [`unresolved::${candA.candidateId}`, `unresolved::${candB.candidateId}`],
      decision: "DIFFERENT_PRODUCTS",
      areSameListing: false,
      areSameActualProduct: false,
      areSameVariant: false,
      areSameFamily: false,
      areDistinctOpportunitiesForBroadNiche: false,
      areDistinctOpportunitiesForSpecificQuery: false,
      confidence: "AMBIGUOUS",
      uncertainty: "Unidentified ad observations without landing URLs cannot be merged.",
      supportingEvidence: [],
      conflictingEvidence: ["One or both candidates have UNRESOLVED product identity and no destination URL."],
      reason: "Unresolved ad candidates without product URLs are kept separate.",
    };
  }

  // 5. Different Product Families / Different Physical Head Nouns (B18)
  if (!areSameFamily) {
    conflictingEvidence.push(
      `Different product families: '${fpA.familyKey}' (${fpA.familyLabel}) vs '${fpB.familyKey}' (${fpB.familyLabel}).`
    );
    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [fpA.productKey, fpB.productKey],
      familyKeys: [fpA.familyKey, fpB.familyKey],
      decision: "DIFFERENT_PRODUCTS",
      areSameListing: false,
      areSameActualProduct: false,
      areSameVariant: false,
      areSameFamily: false,
      areDistinctOpportunitiesForBroadNiche: true,
      areDistinctOpportunitiesForSpecificQuery: true,
      confidence: "EXACT",
      uncertainty: null,
      supportingEvidence,
      conflictingEvidence,
      reason: `Candidates represent different physical product families ('${fpA.familyLabel}' vs '${fpB.familyLabel}').`,
    };
  }

  // 6. Same Product Family: Evaluate Same Merchant vs Cross-Merchant & Specs/Tokens
  const tokenSim = computeTokenJaccard(
    fpA.normalizedProductTokens,
    fpB.normalizedProductTokens
  );
  const exactTitleMatch =
    fpA.normalizedCleanTitle.toLowerCase() === fpB.normalizedCleanTitle.toLowerCase();

  // Check if same merchant (or both unlinked with identical canonical product name)
  const hasSameVerifiedDomain = Boolean(
    fpA.normalizedDomain &&
      fpB.normalizedDomain &&
      fpA.normalizedDomain === fpB.normalizedDomain
  );
  const bothMissingDomain = !fpA.normalizedDomain && !fpB.normalizedDomain;

  // Check if same merchant with variant handle suffix (e.g. -blue-2pack vs -red-3pack)
  const baseHandleA = stripVariantHandleSuffixes(fpA.productHandle);
  const baseHandleB = stripVariantHandleSuffixes(fpB.productHandle);
  if (
    hasSameVerifiedDomain &&
    baseHandleA &&
    baseHandleB &&
    baseHandleA.length >= 4 &&
    baseHandleA === baseHandleB &&
    fpA.productHandle !== fpB.productHandle &&
    (!fpA.normalizedModel || !fpB.normalizedModel || fpA.normalizedModel === fpB.normalizedModel) &&
    (!fpA.physicalSpecs.capacity || !fpB.physicalSpecs.capacity || fpA.physicalSpecs.capacity === fpB.physicalSpecs.capacity)
  ) {
    supportingEvidence.push(
      `Same merchant (${fpA.normalizedDomain}) and identical base product handle '${baseHandleA}' after stripping color/size/pack variant suffixes ('${fpA.productHandle}' vs '${fpB.productHandle}').`
    );
    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [fpA.productKey, fpA.productKey],
      familyKeys: [fpA.familyKey, fpB.familyKey],
      decision: "SAME_PRODUCT_DIFFERENT_VARIANT",
      areSameListing: false,
      areSameActualProduct: true,
      areSameVariant: false,
      areSameFamily: true,
      areDistinctOpportunitiesForBroadNiche: false,
      areDistinctOpportunitiesForSpecificQuery: false,
      confidence: "HIGH_CONFIDENCE",
      uncertainty: null,
      supportingEvidence,
      conflictingEvidence,
      reason: `Color, size, or pack-count variant handles ('${fpA.productHandle}' vs '${fpB.productHandle}') of the same product ('${baseHandleA}') on ${fpA.normalizedDomain}.`,
    };
  }

  if (
    !fpA.normalizedCanonicalUrl &&
    !fpB.normalizedCanonicalUrl &&
    ((hasSameVerifiedDomain &&
      (exactTitleMatch ||
        (tokenSim >= 0.75 &&
          fpA.normalizedProductTokens.length >= 2 &&
          fpB.normalizedProductTokens.length >= 2))) ||
      (bothMissingDomain && exactTitleMatch && fpA.normalizedCleanTitle.length >= 3))
  ) {
    supportingEvidence.push(
      `Same product family ('${fpA.familyKey}') and high product title alignment (similarity=${tokenSim.toFixed(2)}) on ${
        fpA.normalizedDomain || "unlinked domain"
      }.`
    );
    return {
      candidateIds: [candA.candidateId, candB.candidateId],
      listingKeys: [fpA.listingKey, fpB.listingKey],
      productKeys: [fpA.productKey, fpA.productKey],
      familyKeys: [fpA.familyKey, fpB.familyKey],
      decision: "SAME_MERCHANT_SAME_PRODUCT_NAME",
      areSameListing: true,
      areSameActualProduct: true,
      areSameVariant: true,
      areSameFamily: true,
      areDistinctOpportunitiesForBroadNiche: false,
      areDistinctOpportunitiesForSpecificQuery: false,
      confidence: "HIGH_CONFIDENCE",
      uncertainty: null,
      supportingEvidence,
      conflictingEvidence,
      reason: `Duplicate product candidate for '${fpA.normalizedCleanTitle}' within ${
        fpA.normalizedDomain || "same source context"
      }.`,
    };
  }

  // Check if one has a verified brand/capacity/model that explicitly differs from the other
  const hasDifferentVerifiedBrands = Boolean(
    fpA.normalizedBrand &&
      fpB.normalizedBrand &&
      fpA.normalizedBrand !== fpB.normalizedBrand
  );
  const hasDifferentCapacities = Boolean(
    fpA.physicalSpecs.capacity &&
      fpB.physicalSpecs.capacity &&
      fpA.physicalSpecs.capacity !== fpB.physicalSpecs.capacity
  );

  if (hasDifferentVerifiedBrands) {
    conflictingEvidence.push(
      `Different brands ('${fpA.normalizedBrand}' vs '${fpB.normalizedBrand}') within family '${fpA.familyKey}'.`
    );
  }
  if (hasDifferentCapacities) {
    conflictingEvidence.push(
      `Different physical capacities ('${fpA.physicalSpecs.capacity}' vs '${fpB.physicalSpecs.capacity}').`
    );
  }

  // Cross-merchant or different-URL candidates in the same family without verified model/GTIN
  supportingEvidence.push(
    `Both listings belong to product family '${fpA.familyKey}' (${fpA.familyLabel}), token similarity=${tokenSim.toFixed(2)}.`
  );

  const uncertaintyMsg =
    "Both listings sell a product in the same functional family across different URLs/merchants without verified GTIN or manufacturer model numbers to confirm whether they are the exact same factory SKU or distinct supplier models.";

  return {
    candidateIds: [candA.candidateId, candB.candidateId],
    listingKeys: [fpA.listingKey, fpB.listingKey],
    productKeys: [fpA.productKey, fpB.productKey],
    familyKeys: [fpA.familyKey, fpB.familyKey],
    decision: "UNKNOWN_CROSS_MERCHANT_SAME_FAMILY",
    areSameListing: false,
    areSameActualProduct: null,
    areSameVariant: false,
    areSameFamily: true,
    // Section 5.6: For a BROAD_CATEGORY niche, multiple listings of the same product family (e.g. 3 oil dispensers)
    // do NOT count as 3 independent functional opportunities!
    areDistinctOpportunitiesForBroadNiche: false,
    // For a SPECIFIC_PRODUCT query (e.g. "glass oil dispenser"), they only count as distinct model alternatives
    // if they have verified distinguishing brand/capacity/model evidence
    areDistinctOpportunitiesForSpecificQuery:
      hasDifferentVerifiedBrands || hasDifferentCapacities,
    confidence: "AMBIGUOUS",
    uncertainty: uncertaintyMsg,
    supportingEvidence,
    conflictingEvidence,
    reason: `${uncertaintyMsg} For broad niche discovery, they share the single family '${fpA.familyLabel}'.`,
  };
}

export interface ProductCluster<T extends DistinctnessCandidateLike = DistinctnessCandidateLike> {
  clusterId: string;
  productKey: string;
  familyKey: string;
  familyLabel: string;
  primaryCandidate: T;
  mergedCandidates: T[];
  listingKeys: string[];
  observationKeys: string[];
  mergeDecisions: PairwiseIdentityComparison[];
}

export interface CandidateClusteringResult<T extends DistinctnessCandidateLike = DistinctnessCandidateLike> {
  clusters: ProductCluster<T>[];
  consolidatedCandidates: T[];
  distinctProductCount: number;
  distinctFamilyCount: number;
  distinctListingCount: number;
  unknownCrossMerchantPairs: PairwiseIdentityComparison[];
  allPairwiseDecisions: PairwiseIdentityComparison[];
}

/**
 * Clusters candidates into actual products (merging duplicates that share the same actual product
 * via canonical URL, merchant product ID, GTIN, brand+model, or same-merchant product name)
 * while recording all pairwise merge/separate decisions and cross-merchant uncertainties.
 */
export function clusterProductCandidates<T extends DistinctnessCandidateLike>(
  candidates: T[],
  mergeHook?: (primary: T, duplicate: T, decision: PairwiseIdentityComparison) => T
): CandidateClusteringResult<T> {
  const clusters: ProductCluster<T>[] = [];
  const allPairwiseDecisions: PairwiseIdentityComparison[] = [];
  const unknownCrossMerchantPairs: PairwiseIdentityComparison[] = [];
  const allListingKeys = new Set<string>();

  for (const cand of candidates) {
    const fp = buildProductIdentityFingerprint(cand);
    allListingKeys.add(fp.listingKey);

    let mergedIntoCluster: ProductCluster<T> | null = null;

    for (const cluster of clusters) {
      const comparison = compareProductIdentity(cluster.primaryCandidate, cand);
      allPairwiseDecisions.push(comparison);

      if (comparison.decision === "UNKNOWN_CROSS_MERCHANT_SAME_FAMILY") {
        unknownCrossMerchantPairs.push(comparison);
      }

      if (comparison.areSameActualProduct === true) {
        mergedIntoCluster = cluster;
        cluster.mergedCandidates.push(cand);
        cluster.mergeDecisions.push(comparison);
        if (!cluster.listingKeys.includes(fp.listingKey)) {
          cluster.listingKeys.push(fp.listingKey);
        }
        for (const obsKey of fp.observationKeys) {
          if (!cluster.observationKeys.includes(obsKey)) {
            cluster.observationKeys.push(obsKey);
          }
        }
        if (mergeHook) {
          cluster.primaryCandidate = mergeHook(
            cluster.primaryCandidate,
            cand,
            comparison
          );
        }
        break;
      }
    }

    if (!mergedIntoCluster) {
      clusters.push({
        clusterId: `cluster_${clusters.length + 1}_${fp.productKey}`,
        productKey: fp.productKey,
        familyKey: fp.familyKey,
        familyLabel: fp.familyLabel,
        primaryCandidate: cand,
        mergedCandidates: [cand],
        listingKeys: [fp.listingKey],
        observationKeys: [...fp.observationKeys],
        mergeDecisions: [],
      });
    }
  }

  const consolidatedCandidates = clusters.map((c) => c.primaryCandidate);
  const distinctFamilies = new Set(clusters.map((c) => c.familyKey));

  return {
    clusters,
    consolidatedCandidates,
    distinctProductCount: clusters.length,
    distinctFamilyCount: distinctFamilies.size,
    distinctListingCount: allListingKeys.size,
    unknownCrossMerchantPairs,
    allPairwiseDecisions,
  };
}

export interface OpportunityDiversityEvaluation {
  isDistinct: boolean;
  isFamilyDiverse: boolean;
  distinctCount: number; // Distinct actual products (unique productKeys)
  distinctProductCount: number;
  distinctFamilyCount: number;
  distinctListingCount: number;
  independentOpportunityCount: number;
  homogeneousFamilyDetected: boolean;
  dominantFamilyKey: string | null;
  dominantFamilyLabel: string | null;
  duplicateKeys: string[];
  familyKeys: string[];
  productKeys: string[];
  uncertainties: string[];
  pairwiseDecisions: PairwiseIdentityComparison[];
  diversitySummary: string;
}

/**
 * Evaluates both actual product distinctness AND product family diversity across a shortlist or winner set (Section 5.6 & F01 & F07).
 */
export function evaluateOpportunityDiversity(
  shortlist: DistinctnessCandidateLike[],
  options?: {
    nicheIntent?:
      | "BROAD_CATEGORY"
      | "SPECIFIC_PRODUCT"
      | "FUNCTIONAL_NEED"
      | "AMBIGUOUS"
      | "UNSUPPORTED"
      | string;
    topic?: string;
  }
): OpportunityDiversityEvaluation {
  if (!shortlist || shortlist.length === 0) {
    return {
      isDistinct: true,
      isFamilyDiverse: true,
      distinctCount: 0,
      distinctProductCount: 0,
      distinctFamilyCount: 0,
      distinctListingCount: 0,
      independentOpportunityCount: 0,
      homogeneousFamilyDetected: false,
      dominantFamilyKey: null,
      dominantFamilyLabel: null,
      duplicateKeys: [],
      familyKeys: [],
      productKeys: [],
      uncertainties: [],
      pairwiseDecisions: [],
      diversitySummary: "No candidates in shortlist.",
    };
  }

  const fingerprints = shortlist.map((c) => buildProductIdentityFingerprint(c));
  const pairwiseDecisions: PairwiseIdentityComparison[] = [];
  const duplicateKeys: string[] = [];
  const uncertainties: string[] = [];

  // Track unique actual products via union-find / pairwise comparison
  const parentIdx = shortlist.map((_, idx) => idx);
  const findRoot = (i: number): number => {
    while (parentIdx[i] !== i) {
      parentIdx[i] = parentIdx[parentIdx[i]];
      i = parentIdx[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const rI = findRoot(i);
    const rJ = findRoot(j);
    if (rI !== rJ) parentIdx[rJ] = rI;
  };

  for (let i = 0; i < shortlist.length; i++) {
    for (let j = i + 1; j < shortlist.length; j++) {
      const comp = compareProductIdentity(shortlist[i], shortlist[j]);
      pairwiseDecisions.push(comp);

      if (comp.areSameActualProduct === true) {
        union(i, j);
        duplicateKeys.push(fingerprints[j].productKey);
      }
      if (comp.uncertainty) {
        uncertainties.push(
          `[${shortlist[i].candidateId} vs ${shortlist[j].candidateId}]: ${comp.uncertainty}`
        );
      }
    }
  }

  const uniqueProductRoots = new Set(shortlist.map((_, idx) => findRoot(idx)));
  const distinctProductCount = uniqueProductRoots.size;
  const familyCounts = new Map<string, { count: number; label: string }>();

  for (const fp of fingerprints) {
    if (
      fp.familyKey === "unresolved_family" ||
      fp.familyKey === "UNRESOLVED_FAMILY"
    ) {
      continue;
    }
    const prev = familyCounts.get(fp.familyKey) || { count: 0, label: fp.familyLabel };
    familyCounts.set(fp.familyKey, { count: prev.count + 1, label: fp.familyLabel });
  }

  const distinctFamilyCount = familyCounts.size;
  const distinctListingCount = new Set(fingerprints.map((f) => f.listingKey)).size;

  let dominantFamilyKey: string | null = null;
  let dominantFamilyLabel: string | null = null;
  let maxFamCount = 0;
  for (const [k, v] of familyCounts.entries()) {
    if (v.count > maxFamCount) {
      maxFamCount = v.count;
      dominantFamilyKey = k;
      dominantFamilyLabel = v.label;
    }
  }

  const homogeneousFamilyDetected =
    shortlist.length >= 2 && distinctFamilyCount === 1;

  const isSpecificQuery = options?.nicheIntent === "SPECIFIC_PRODUCT";

  // Count independent opportunities:
  // - For BROAD_CATEGORY: each product family contributes 1 primary opportunity unless distinct verified models are explicitly differentiated,
  //   and unverified cross-merchant listings in the same family do NOT inflate independent opportunity count.
  // - For SPECIFIC_PRODUCT: distinct products/models with distinguishing evidence count as alternatives.
  let independentOpportunityCount = distinctProductCount;
  if (!isSpecificQuery) {
    // Subtract pairs that are UNKNOWN_CROSS_MERCHANT_SAME_FAMILY
    const oppRoots = shortlist.map((_, idx) => idx);
    const findOppRoot = (i: number): number => {
      while (oppRoots[i] !== i) {
        oppRoots[i] = oppRoots[oppRoots[i]];
        i = oppRoots[i];
      }
      return oppRoots[i];
    };
    let idx = 0;
    for (let i = 0; i < shortlist.length; i++) {
      for (let j = i + 1; j < shortlist.length; j++) {
        const comp = pairwiseDecisions[idx++];
        if (
          comp.areSameActualProduct === true ||
          !comp.areDistinctOpportunitiesForBroadNiche
        ) {
          const rI = findOppRoot(i);
          const rJ = findOppRoot(j);
          if (rI !== rJ) oppRoots[rJ] = rI;
        }
      }
    }
    independentOpportunityCount = new Set(
      shortlist.map((_, i) => findOppRoot(i))
    ).size;
  }

  const isDistinct =
    distinctProductCount === shortlist.length && duplicateKeys.length === 0;
  const isFamilyDiverse = isSpecificQuery
    ? distinctProductCount === shortlist.length
    : distinctFamilyCount === shortlist.length;

  let diversitySummary: string;
  if (!isDistinct) {
    diversitySummary = `Duplicate actual product detected: ${shortlist.length} cards resolve to only ${distinctProductCount} distinct product(s) (${duplicateKeys.join(", ")}).`;
  } else if (homogeneousFamilyDetected && !isSpecificQuery) {
    diversitySummary = `All ${shortlist.length} listings belong to a single product family ('${dominantFamilyLabel}', familyKey='${dominantFamilyKey}'). They represent ${distinctProductCount} listing(s) within 1 functional family (${independentOpportunityCount} independent category opportunity).`;
  } else if (distinctFamilyCount < shortlist.length && !isSpecificQuery) {
    diversitySummary = `${shortlist.length} distinct product listings spanning ${distinctFamilyCount} product families (${independentOpportunityCount} independent category opportunities).`;
  } else {
    diversitySummary = `${distinctProductCount} distinct products across ${distinctFamilyCount} product family/subcategory group(s).`;
  }

  return {
    isDistinct,
    isFamilyDiverse,
    distinctCount: distinctProductCount,
    distinctProductCount,
    distinctFamilyCount,
    distinctListingCount,
    independentOpportunityCount,
    homogeneousFamilyDetected,
    dominantFamilyKey,
    dominantFamilyLabel,
    duplicateKeys,
    familyKeys: fingerprints.map((f) => f.familyKey),
    productKeys: fingerprints.map((f) => f.productKey),
    uncertainties,
    pairwiseDecisions,
    diversitySummary,
  };
}
