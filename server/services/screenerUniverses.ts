// Curated thematic universes. Composition is the analyst's job — these are the
// 25-name lists for each theme. US-listed primary filers, $10B+ market cap when
// applicable. NOT financial advice. Adjust as market moves.

export interface UniverseDef {
  id: string;
  label: string;
  description: string;
  tickers: string[];
  thesisHooks: Record<string, string>;
  notes?: string[];
}

export const UNIVERSES: Record<string, UniverseDef> = {
  AI_INFRA: {
    id: "AI_INFRA",
    label: "AI Infrastructure",
    description: "Compute, networking, memory, power, optical, foundry support — the AI buildout supply chain.",
    tickers: [
      "NVDA","AVGO","AMD","MU","ANET","MRVL","CRDO","VRT","ETN","GEV",
      "CEG","VST","TLN","DLR","EQIX","APH","COHR","LITE","FN","KLAC",
      "LRCX","AMAT","DELL","SMCI","CIEN",
    ],
    thesisHooks: {
      NVDA: "GPU monopoly + CUDA software lock-in; data center >85% of revenue.",
      AVGO: "Custom AI ASICs (Google TPU, Meta MTIA) + VMware software cross-sell.",
      AMD: "MI300/MI350 GPU challenger, EPYC CPU dominance in AI servers.",
      MU: "HBM3E sold out; only 3 HBM suppliers globally.",
      ANET: "400G/800G Ethernet fabrics displacing InfiniBand at hyperscalers.",
      MRVL: "Custom silicon for Amazon Trainium + optical PHYs.",
      CRDO: "Active electrical cables, retimers — picks-and-shovels for AI racks.",
      VRT: "Liquid cooling attach rate inflecting with GB200 rack rollout.",
      ETN: "Electrical infra/switchgear backlog from hyperscaler buildouts.",
      GEV: "Gas turbines + grid equipment powering AI data center growth.",
      CEG: "Nuclear PPAs to Microsoft; baseload AI power.",
      VST: "Nuclear + gas generation contracted to AI hyperscalers.",
      TLN: "Susquehanna nuclear PPA with Amazon AWS.",
      DLR: "Wholesale data center REIT; AI workload tenant mix growing.",
      EQIX: "Interconnection + colocation hub for AI distributed inference.",
      APH: "High-speed connectors and copper cabling content per AI rack.",
      COHR: "Datacom transceivers + InP laser vertical integration.",
      LITE: "800G/1.6T optical transceivers, EML lasers.",
      FN: "Contract manufacturer for optical modules (Nvidia, Cisco).",
      KLAC: "Process control / metrology — bottleneck for leading-edge nodes.",
      LRCX: "Etch + deposition critical for HBM and 3D NAND.",
      AMAT: "Broad semicap exposure across logic + memory.",
      DELL: "Largest revenue exposure to GB200 AI server rack systems.",
      SMCI: "Liquid-cooled AI server racks, Nvidia reference designs.",
      CIEN: "Long-haul + DCI optical for hyperscaler campus interconnect.",
    },
    notes: [
      "ADRs excluded by design — TSM, ASML, ARM not in this list despite being core AI infra.",
      "INTC excluded — would fail quality gate; foundry ramp unproven.",
    ],
  },

  SEMIS: {
    id: "SEMIS",
    label: "Semiconductors (design + foundry + equipment)",
    description: "US-listed chip designers, equipment makers, and packaging/test.",
    tickers: [
      "NVDA","AVGO","AMD","MU","INTC","QCOM","TXN","ADI","MRVL","ON",
      "MCHP","NXPI","MPWR","SWKS","QRVO","AMAT","LRCX","KLAC","ENTG","TER",
      "ACLS","ONTO","FORM","COHU","AMKR",
    ],
    thesisHooks: {},
  },

  CYBERSEC: {
    id: "CYBERSEC",
    label: "Cybersecurity",
    description: "Endpoint, network, identity, cloud security pure-plays.",
    tickers: [
      "CRWD","PANW","ZS","S","FTNT","OKTA","NET","TENB","RBRK","CYBR",
      "QLYS","VRNS","CHKP","FFIV","AKAM","DDOG","ESTC",
    ],
    thesisHooks: {
      CRWD: "Falcon platform consolidation across endpoint+cloud+identity.",
      PANW: "Platformization push; XSIAM displacing legacy SIEM.",
      ZS: "Zero Trust Exchange + ZIA/ZPA bundle moat.",
      S: "Singularity AI-driven autonomous response.",
      FTNT: "Hardware+software firewall integration; SD-WAN attach.",
    },
    notes: ["Fewer than 25 — only ~17 large-cap pure-plays in cyber qualify."],
  },

  GLP1: {
    id: "GLP1",
    label: "GLP-1 / Obesity",
    description: "Manufacturers, suppliers, and adjacent therapeutics.",
    tickers: ["LLY","NVO","VKTX","AMGN","PFE","REGN","ZBH","SYK","WW"],
    thesisHooks: {
      LLY: "Mounjaro/Zepbound dominance; orforglipron oral pipeline.",
      NVO: "Ozempic/Wegovy; ADR — flag if your filter excludes ADRs.",
      VKTX: "VK2735 oral GLP-1; M&A target speculation.",
    },
    notes: [
      "NVO is an ADR — exclude if your rules disallow ADRs.",
      "Fewer than 25 — only a small set of large-caps directly tied to GLP-1.",
    ],
  },

  DEFENSE: {
    id: "DEFENSE",
    label: "Defense Primes + Tier 1",
    description: "Prime contractors and major defense suppliers.",
    tickers: [
      "LMT","NOC","RTX","GD","BA","HII","LHX","TDG","HEI","AXON",
      "PLTR","KTOS","LDOS","BAH","SAIC","CW","WWD","HXL","TXT",
    ],
    thesisHooks: {},
  },

  CARDS: {
    id: "CARDS",
    label: "Credit-Card Networks + Payments",
    description: "Networks and adjacent payment rails.",
    tickers: ["V","MA","AXP","DFS","COF","SYF","FIS","FISV","PYPL","SQ"],
    thesisHooks: {
      V: "Network duopoly + cross-border high-margin volumes.",
      MA: "Same duopoly; faster volume growth ex-US.",
      AXP: "Closed-loop network + premium card economics.",
    },
    notes: ["Pure 'networks' is only 3 names — extended to large-cap payments."],
  },

  SOFTWARE_DISCOUNT: {
    id: "SOFTWARE_DISCOUNT",
    label: "Software (drawdown candidates)",
    description: "Large-cap software historically subject to >30% drawdowns — verify current levels live.",
    tickers: [
      "ADBE","CRM","NOW","INTU","ORCL","WDAY","SNOW","DDOG","NET","TEAM",
      "ZS","CRWD","PANW","HUBS","MDB","OKTA","SHOP","DOCU","TWLO","U",
      "PATH","ESTC","VEEV","ADSK","ANSS",
    ],
    thesisHooks: {},
    notes: ["Discount status MUST be verified against live 52w highs — list is candidates only."],
  },

  RESHORING: {
    id: "RESHORING",
    label: "Re-shoring Industrials",
    description: "Domestic capex beneficiaries — equipment, infra, materials.",
    tickers: [
      "CAT","DE","ETN","PWR","URI","VMC","MLM","NUE","STLD","CLF",
      "X","AA","FAST","GWW","ROP","ROK","EMR","HUBB","JCI","TT",
      "PH","PNR","XYL","WSO","ITT",
    ],
    thesisHooks: {},
  },

  PHOTONICS: {
    id: "PHOTONICS",
    label: "Photonics / Optical",
    description: "Optical components, transceivers, lasers, photonic integration.",
    tickers: ["COHR","LITE","FN","CIEN","AAOI","IPGP","NVMI","ONTO","MKSI","II","POET","ITRI"],
    thesisHooks: {},
    notes: ["Fewer than 25 — small theme; some names borderline market cap."],
  },

  MEMORY: {
    id: "MEMORY",
    label: "Memory + Storage",
    description: "DRAM, HBM, NAND, HDD, controllers.",
    tickers: ["MU","WDC","STX","SNDK","SIMO","KLAC","LRCX","AMAT","ONTO","ACLS","FORM","ASML","MRVL"],
    thesisHooks: {
      MU: "HBM3E + DDR5 cycle leader; HBM4 sampling.",
      WDC: "NAND business spinoff; pricing leverage if cycle holds.",
      STX: "HAMR ramp + AI storage tailwind from inference scale-out.",
      SNDK: "Pure-play NAND post-WDC split.",
    },
    notes: [
      "ASML included on relevance even though ADR — flag for your rules.",
      "Fewer than 25 — narrow theme.",
    ],
  },

  AI_TESTING: {
    id: "AI_TESTING",
    label: "AI Testing / Validation",
    description: "ATE (auto test equipment), interconnect test, advanced packaging inspection.",
    tickers: ["TER","KEYS","ANSS","COHU","AEHR","ONTO","FORM","NVMI","ACLS","IPGP","KLAC","CDNS","SNPS"],
    thesisHooks: {
      TER: "HBM/SoC test demand from Nvidia/AMD/custom silicon.",
      KEYS: "5G + AI infra electronic test instruments.",
      CDNS: "EDA + emulation demand for AI silicon design.",
      SNPS: "EDA duopoly + IP for AI accelerators.",
    },
    notes: ["Fewer than 25 — narrow theme."],
  },
};

export function listUniverses(): { id: string; label: string; tickerCount: number }[] {
  return Object.values(UNIVERSES).map((u) => ({
    id: u.id,
    label: u.label,
    tickerCount: u.tickers.length,
  }));
}
