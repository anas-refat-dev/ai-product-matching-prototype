module.exports = [
  {
    name: "لبن",
    aliases: ["حليب", "ميلك", "لبب"],
    variants: [
      { brand: "جهينة", size: 1, unit: "L", price: 25 },
      { brand: "جهينة", size: 1.5, unit: "L", price: 35 },
      { brand: "المراعي", size: 1, unit: "L", price: 24 },
      { brand: "المراعي", size: 1.5, unit: "L", price: 34 },
    ],
  },
  {
    name: "بيض",
    aliases: ["بيضة", "بيضه", "بيضات"],
    variants: [{ brand: null, size: null, unit: null, price: 3.5 }],
  },
  {
    name: "عيش",
    aliases: ["عيش بلدي", "خبز", "aish", "3aish"],
    variants: [
      { brand: "بلدي", size: null, unit: null, price: 1 },
      { brand: "فينو", size: null, unit: null, price: 2 },
    ],
  },
  {
    name: "سكر",
    aliases: ["السكر", "sokkar"],
    variants: [
      { brand: null, size: 1, unit: "kg", price: 30 },
      { brand: null, size: 2, unit: "kg", price: 58 },
    ],
  },
  {
    name: "رز",
    aliases: ["الرز", "أرز", "roz"],
    variants: [
      { brand: "المنار", size: 1, unit: "kg", price: 28 },
      { brand: "المنار", size: 5, unit: "kg", price: 130 },
    ],
  },
  {
    name: "دقيق",
    aliases: ["طحين", "da2ee2"],
    variants: [
      { brand: "المنار", size: 1, unit: "kg", price: 22 },
      { brand: "المنار", size: 5, unit: "kg", price: 100 },
    ],
  },
  {
    name: "زيت",
    aliases: ["زيت طعام", "زيت طبخ", "zeit"],
    variants: [
      { brand: "كريستال", size: 1, unit: "L", price: 60 },
      { brand: "عافية", size: 1.5, unit: "L", price: 85 },
    ],
  },
  {
    name: "مكرونة",
    aliases: ["macarona", "pasta", "معكرونة"],
    variants: [{ brand: "ماركا", size: 400, unit: "g", price: 15 }],
  },
  {
    name: "جبنة",
    aliases: ["جبن", "gebna", "cheese"],
    variants: [
      { brand: "المراعي", size: null, unit: null, price: 45 },
      { brand: "دومتي", size: null, unit: null, price: 42 },
    ],
  },
  {
    name: "شاي",
    aliases: ["شاى", "chai", "tea"],
    variants: [{ brand: "ليبتون", size: null, unit: null, price: 35 }],
  },
];
