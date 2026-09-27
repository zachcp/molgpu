/* Generated from PDB2PQR commit 9babf94e6f9f1792b4efadb9e997955cee720d61.
 * AMBER.DAT, AMBER.names, AA.xml, NA.xml. Cornell et al. (1995),
 * Wang, Cieplak & Kollman (2000), Dolinsky et al. (2004).
 * The following PDB2PQR license is reproduced verbatim:
 * Copyright (c) 2002-2024, Jens Erik Nielsen; Nathan A. Baker; Battelle Memorial Institute, Developed at the Pacific Northwest National Laboratory, operated by Battelle Memorial Institute, Pacific Northwest Division for the U.S. Department Energy.; Paul Czodrowski & Gerhard Klebe, University of Marburg.
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * * Neither the names of University College Dublin, Battelle Memorial Institute, Pacific Northwest National Laboratory, US Department of Energy, or University of Marburg nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
export const templates: Readonly<
  Record<
    string,
    {
      atoms: Record<string, { charge: number; parent?: string }>;
      aliases: Record<string, string>;
    }
  >
> = {
  "ALA": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0337,
      },
      "HA": {
        "charge": 0.0823,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1825,
      },
      "HB1": {
        "charge": 0.0603,
        "parent": "CB",
      },
      "HB2": {
        "charge": 0.0603,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0603,
        "parent": "CB",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "1HB": "HB1",
      "2HB": "HB2",
      "3HB": "HB3",
    },
  },
  "ARG": {
    "atoms": {
      "N": {
        "charge": -0.3479,
      },
      "H": {
        "charge": 0.2747,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2637,
      },
      "HA": {
        "charge": 0.156,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0007,
      },
      "HB2": {
        "charge": 0.0327,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0327,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.039,
      },
      "HG2": {
        "charge": 0.0285,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0285,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.0486,
      },
      "HD2": {
        "charge": 0.0687,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0687,
        "parent": "CD",
      },
      "NE": {
        "charge": -0.5295,
      },
      "HE": {
        "charge": 0.3456,
        "parent": "NE",
      },
      "CZ": {
        "charge": 0.8076,
      },
      "NH1": {
        "charge": -0.8627,
      },
      "HH11": {
        "charge": 0.4478,
        "parent": "NH1",
      },
      "HH12": {
        "charge": 0.4478,
        "parent": "NH1",
      },
      "NH2": {
        "charge": -0.8627,
      },
      "HH21": {
        "charge": 0.4478,
        "parent": "NH2",
      },
      "HH22": {
        "charge": 0.4478,
        "parent": "NH2",
      },
      "C": {
        "charge": 0.7341,
      },
      "O": {
        "charge": -0.5894,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "1HH1": "HH11",
      "2HH1": "HH12",
      "1HH2": "HH21",
      "2HH2": "HH22",
    },
  },
  "ASH": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0341,
      },
      "HA": {
        "charge": 0.0864,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0316,
      },
      "HB2": {
        "charge": 0.0488,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0488,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.6462,
      },
      "OD1": {
        "charge": -0.5554,
      },
      "OD2": {
        "charge": -0.6376,
      },
      "HD2": {
        "charge": 0.4747,
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "ASN": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0143,
      },
      "HA": {
        "charge": 0.1048,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.2041,
      },
      "HB2": {
        "charge": 0.0797,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0797,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.713,
      },
      "OD1": {
        "charge": -0.5931,
      },
      "ND2": {
        "charge": -0.9191,
      },
      "HD21": {
        "charge": 0.4196,
        "parent": "ND2",
      },
      "HD22": {
        "charge": 0.4196,
        "parent": "ND2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HD2": "HD22",
      "1HD2": "HD21",
    },
  },
  "ASP": {
    "atoms": {
      "N": {
        "charge": -0.5163,
      },
      "H": {
        "charge": 0.2936,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0381,
      },
      "HA": {
        "charge": 0.088,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0303,
      },
      "HB2": {
        "charge": -0.0122,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0122,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.7994,
      },
      "OD1": {
        "charge": -0.8014,
      },
      "OD2": {
        "charge": -0.8014,
      },
      "C": {
        "charge": 0.5366,
      },
      "O": {
        "charge": -0.5819,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CYM": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0351,
      },
      "HA": {
        "charge": 0.0508,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.2413,
      },
      "HB3": {
        "charge": 0.1122,
        "parent": "CB",
      },
      "HB2": {
        "charge": 0.1122,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.8844,
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CYS": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0213,
      },
      "HA": {
        "charge": 0.1124,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1231,
      },
      "HB2": {
        "charge": 0.1112,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1112,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.3119,
      },
      "HG": {
        "charge": 0.1933,
        "parent": "SG",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HG": "HG",
      "HG1": "HG",
    },
  },
  "CYX": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0429,
      },
      "HA": {
        "charge": 0.0766,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.079,
      },
      "HB2": {
        "charge": 0.091,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.091,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.1081,
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "GLH": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0145,
      },
      "HA": {
        "charge": 0.0779,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0071,
      },
      "HB2": {
        "charge": 0.0256,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0256,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0174,
      },
      "HG2": {
        "charge": 0.043,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.043,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.6801,
      },
      "OE1": {
        "charge": -0.5838,
      },
      "OE2": {
        "charge": -0.6511,
      },
      "HE2": {
        "charge": 0.4641,
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
    },
  },
  "GLN": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0031,
      },
      "HA": {
        "charge": 0.085,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0036,
      },
      "HB2": {
        "charge": 0.0171,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0171,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0645,
      },
      "HG2": {
        "charge": 0.0352,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0352,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.6951,
      },
      "OE1": {
        "charge": -0.6086,
      },
      "NE2": {
        "charge": -0.9407,
      },
      "HE21": {
        "charge": 0.4251,
        "parent": "NE2",
      },
      "HE22": {
        "charge": 0.4251,
        "parent": "NE2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE2": "HE21",
      "2HE2": "HE22",
    },
  },
  "GLU": {
    "atoms": {
      "N": {
        "charge": -0.5163,
      },
      "H": {
        "charge": 0.2936,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0397,
      },
      "HA": {
        "charge": 0.1105,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.056,
      },
      "HB2": {
        "charge": -0.0173,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0173,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0136,
      },
      "HG2": {
        "charge": -0.0425,
        "parent": "CG",
      },
      "HG3": {
        "charge": -0.0425,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.8054,
      },
      "OE1": {
        "charge": -0.8188,
      },
      "OE2": {
        "charge": -0.8188,
      },
      "C": {
        "charge": 0.5366,
      },
      "O": {
        "charge": -0.5819,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
    },
  },
  "GLY": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0252,
      },
      "HA2": {
        "charge": 0.0698,
        "parent": "CA",
      },
      "HA3": {
        "charge": 0.0698,
        "parent": "CA",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HA": "HA2",
      "1HA": "HA3",
      "HA1": "HA3",
      "3HA": "HA3",
    },
  },
  "HID": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0188,
      },
      "HA": {
        "charge": 0.0881,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0462,
      },
      "HB2": {
        "charge": 0.0402,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0402,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0266,
      },
      "ND1": {
        "charge": -0.3811,
      },
      "HD1": {
        "charge": 0.3649,
        "parent": "ND1",
      },
      "CE1": {
        "charge": 0.2057,
      },
      "HE1": {
        "charge": 0.1392,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.5727,
      },
      "CD2": {
        "charge": 0.1292,
      },
      "HD2": {
        "charge": 0.1147,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "HIE": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0581,
      },
      "HA": {
        "charge": 0.136,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0074,
      },
      "HB2": {
        "charge": 0.0367,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0367,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.1868,
      },
      "ND1": {
        "charge": -0.5432,
      },
      "CE1": {
        "charge": 0.1635,
      },
      "HE1": {
        "charge": 0.1435,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.2795,
      },
      "HE2": {
        "charge": 0.3339,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.2207,
      },
      "HD2": {
        "charge": 0.1862,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "HIP": {
    "atoms": {
      "N": {
        "charge": -0.3479,
      },
      "H": {
        "charge": 0.2747,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1354,
      },
      "HA": {
        "charge": 0.1212,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0414,
      },
      "HB2": {
        "charge": 0.081,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.081,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0012,
      },
      "ND1": {
        "charge": -0.1513,
      },
      "HD1": {
        "charge": 0.3866,
        "parent": "ND1",
      },
      "CE1": {
        "charge": -0.017,
      },
      "HE1": {
        "charge": 0.2681,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.1718,
      },
      "HE2": {
        "charge": 0.3911,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.1141,
      },
      "HD2": {
        "charge": 0.2317,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.7341,
      },
      "O": {
        "charge": -0.5894,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "ILE": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0597,
      },
      "HA": {
        "charge": 0.0869,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.1303,
      },
      "HB": {
        "charge": 0.0187,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.3204,
      },
      "HG21": {
        "charge": 0.0882,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0882,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0882,
        "parent": "CG2",
      },
      "CG1": {
        "charge": -0.043,
      },
      "HG12": {
        "charge": 0.0236,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0236,
        "parent": "CG1",
      },
      "CD1": {
        "charge": -0.066,
      },
      "HD11": {
        "charge": 0.0186,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.0186,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.0186,
        "parent": "CD1",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "CD": "CD1",
      "HN": "H",
      "2HG1": "HG12",
      "1HG1": "HG13",
      "HG11": "HG13",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
      "1HD1": "HD11",
      "HD1": "HD11",
      "2HD1": "HD12",
      "HD2": "HD12",
      "3HD1": "HD13",
      "HD3": "HD13",
    },
  },
  "LEU": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0518,
      },
      "HA": {
        "charge": 0.0922,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1102,
      },
      "HB2": {
        "charge": 0.0457,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0457,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.3531,
      },
      "HG": {
        "charge": -0.0361,
        "parent": "CG",
      },
      "CD1": {
        "charge": -0.4121,
      },
      "HD11": {
        "charge": 0.1,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.1,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.1,
        "parent": "CD1",
      },
      "CD2": {
        "charge": -0.4121,
      },
      "HD21": {
        "charge": 0.1,
        "parent": "CD2",
      },
      "HD22": {
        "charge": 0.1,
        "parent": "CD2",
      },
      "HD23": {
        "charge": 0.1,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD1": "HD11",
      "2HD1": "HD12",
      "3HD1": "HD13",
      "1HD2": "HD21",
      "2HD2": "HD22",
      "3HD2": "HD23",
    },
  },
  "LYN": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.07206,
      },
      "HA": {
        "charge": 0.0994,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.04845,
      },
      "HB2": {
        "charge": 0.034,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.034,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.06612,
      },
      "HG2": {
        "charge": 0.01041,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.01041,
        "parent": "CG",
      },
      "CD": {
        "charge": -0.03768,
      },
      "HD2": {
        "charge": 0.01155,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.01155,
        "parent": "CD",
      },
      "CE": {
        "charge": 0.32604,
      },
      "HE2": {
        "charge": -0.03358,
        "parent": "CE",
      },
      "HE3": {
        "charge": -0.03358,
        "parent": "CE",
      },
      "NZ": {
        "charge": -1.03581,
      },
      "HZ2": {
        "charge": 0.38604,
        "parent": "NZ",
      },
      "HZ3": {
        "charge": 0.38604,
        "parent": "NZ",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "2HE": "HE2",
      "1HE": "HE3",
      "HE1": "HE3",
      "3HE": "HE3",
      "HZ1": "HZ3",
      "1HZ": "HZ3",
      "2HZ": "HZ2",
      "3HZ": "HZ3",
    },
  },
  "LYS": {
    "atoms": {
      "N": {
        "charge": -0.3479,
      },
      "H": {
        "charge": 0.2747,
        "parent": "N",
      },
      "CA": {
        "charge": -0.24,
      },
      "HA": {
        "charge": 0.1426,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0094,
      },
      "HB2": {
        "charge": 0.0362,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0362,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0187,
      },
      "HG2": {
        "charge": 0.0103,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0103,
        "parent": "CG",
      },
      "CD": {
        "charge": -0.0479,
      },
      "HD2": {
        "charge": 0.0621,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0621,
        "parent": "CD",
      },
      "CE": {
        "charge": -0.0143,
      },
      "HE2": {
        "charge": 0.1135,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.1135,
        "parent": "CE",
      },
      "NZ": {
        "charge": -0.3854,
      },
      "HZ1": {
        "charge": 0.34,
        "parent": "NZ",
      },
      "HZ2": {
        "charge": 0.34,
        "parent": "NZ",
      },
      "HZ3": {
        "charge": 0.34,
        "parent": "NZ",
      },
      "C": {
        "charge": 0.7341,
      },
      "O": {
        "charge": -0.5894,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "2HE": "HE2",
      "1HE": "HE3",
      "HE1": "HE3",
      "3HE": "HE3",
      "1HZ": "HZ1",
      "2HZ": "HZ2",
      "3HZ": "HZ3",
    },
  },
  "MET": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0237,
      },
      "HA": {
        "charge": 0.088,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0342,
      },
      "HB2": {
        "charge": 0.0241,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0241,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0018,
      },
      "HG2": {
        "charge": 0.044,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.044,
        "parent": "CG",
      },
      "SD": {
        "charge": -0.2737,
      },
      "CE": {
        "charge": -0.0536,
      },
      "HE1": {
        "charge": 0.0684,
        "parent": "CE",
      },
      "HE2": {
        "charge": 0.0684,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.0684,
        "parent": "CE",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE": "HE1",
      "2HE": "HE2",
      "3HE": "HE3",
    },
  },
  "PHE": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0024,
      },
      "HA": {
        "charge": 0.0978,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0343,
      },
      "HB2": {
        "charge": 0.0295,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0295,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0118,
      },
      "CD1": {
        "charge": -0.1256,
      },
      "HD1": {
        "charge": 0.133,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.1704,
      },
      "HE1": {
        "charge": 0.143,
        "parent": "CE1",
      },
      "CZ": {
        "charge": -0.1072,
      },
      "HZ": {
        "charge": 0.1297,
        "parent": "CZ",
      },
      "CE2": {
        "charge": -0.1704,
      },
      "HE2": {
        "charge": 0.143,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.1256,
      },
      "HD2": {
        "charge": 0.133,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "PRO": {
    "atoms": {
      "N": {
        "charge": -0.2548,
      },
      "CD": {
        "charge": 0.0192,
      },
      "HD2": {
        "charge": 0.0391,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0391,
        "parent": "CD",
      },
      "CG": {
        "charge": 0.0189,
      },
      "HG2": {
        "charge": 0.0213,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0213,
        "parent": "CG",
      },
      "CB": {
        "charge": -0.007,
      },
      "HB2": {
        "charge": 0.0253,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0253,
        "parent": "CB",
      },
      "CA": {
        "charge": -0.0266,
      },
      "HA": {
        "charge": 0.0641,
        "parent": "CA",
      },
      "C": {
        "charge": 0.5896,
      },
      "O": {
        "charge": -0.5748,
      },
    },
    "aliases": {
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
    },
  },
  "SER": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0249,
      },
      "HA": {
        "charge": 0.0843,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.2117,
      },
      "HB2": {
        "charge": 0.0352,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0352,
        "parent": "CB",
      },
      "OG": {
        "charge": -0.6546,
      },
      "HG": {
        "charge": 0.4275,
        "parent": "OG",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "HG1": "HG",
    },
  },
  "THR": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0389,
      },
      "HA": {
        "charge": 0.1007,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.3654,
      },
      "HB": {
        "charge": 0.0043,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.2438,
      },
      "HG21": {
        "charge": 0.0642,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0642,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0642,
        "parent": "CG2",
      },
      "OG1": {
        "charge": -0.6761,
      },
      "HG1": {
        "charge": 0.4102,
        "parent": "OG1",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "1HG": "HG1",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "TRP": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0275,
      },
      "HA": {
        "charge": 0.1123,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.005,
      },
      "HB2": {
        "charge": 0.0339,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0339,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.1415,
      },
      "CD1": {
        "charge": -0.1638,
      },
      "HD1": {
        "charge": 0.2062,
        "parent": "CD1",
      },
      "NE1": {
        "charge": -0.3418,
      },
      "HE1": {
        "charge": 0.3412,
        "parent": "NE1",
      },
      "CE2": {
        "charge": 0.138,
      },
      "CZ2": {
        "charge": -0.2601,
      },
      "HZ2": {
        "charge": 0.1572,
        "parent": "CZ2",
      },
      "CH2": {
        "charge": -0.1134,
      },
      "HH2": {
        "charge": 0.1417,
        "parent": "CH2",
      },
      "CZ3": {
        "charge": -0.1972,
      },
      "HZ3": {
        "charge": 0.1447,
        "parent": "CZ3",
      },
      "CE3": {
        "charge": -0.2387,
      },
      "HE3": {
        "charge": 0.17,
        "parent": "CE3",
      },
      "CD2": {
        "charge": 0.1243,
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "1HE": "HE1",
      "3HE": "HE3",
      "2HZ": "HZ2",
      "1HZ": "HZ3",
      "HZ1": "HZ3",
      "3HZ": "HZ3",
      "2HH": "HH2",
    },
  },
  "TYR": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0014,
      },
      "HA": {
        "charge": 0.0876,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0152,
      },
      "HB2": {
        "charge": 0.0295,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0295,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0011,
      },
      "CD1": {
        "charge": -0.1906,
      },
      "HD1": {
        "charge": 0.1699,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.2341,
      },
      "HE1": {
        "charge": 0.1656,
        "parent": "CE1",
      },
      "CZ": {
        "charge": 0.3226,
      },
      "OH": {
        "charge": -0.5579,
      },
      "HH": {
        "charge": 0.3992,
        "parent": "OH",
      },
      "CE2": {
        "charge": -0.2341,
      },
      "HE2": {
        "charge": 0.1656,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.1906,
      },
      "HD2": {
        "charge": 0.1699,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "VAL": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0875,
      },
      "HA": {
        "charge": 0.0969,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.2985,
      },
      "HB": {
        "charge": -0.0297,
        "parent": "CB",
      },
      "CG1": {
        "charge": -0.3192,
      },
      "HG11": {
        "charge": 0.0791,
        "parent": "CG1",
      },
      "HG12": {
        "charge": 0.0791,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0791,
        "parent": "CG1",
      },
      "CG2": {
        "charge": -0.3192,
      },
      "HG21": {
        "charge": 0.0791,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0791,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0791,
        "parent": "CG2",
      },
      "C": {
        "charge": 0.5973,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {
      "HN": "H",
      "1HG1": "HG11",
      "2HG1": "HG12",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "CALA": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1747,
      },
      "HA": {
        "charge": 0.1067,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.2093,
      },
      "HB1": {
        "charge": 0.0764,
        "parent": "CB",
      },
      "HB2": {
        "charge": 0.0764,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0764,
        "parent": "CB",
      },
      "C": {
        "charge": 0.7731,
      },
      "O": {
        "charge": -0.8055,
      },
      "OXT": {
        "charge": -0.8055,
      },
    },
    "aliases": {
      "HN": "H",
      "1HB": "HB1",
      "2HB": "HB2",
      "3HB": "HB3",
    },
  },
  "CARG": {
    "atoms": {
      "N": {
        "charge": -0.3481,
      },
      "H": {
        "charge": 0.2764,
        "parent": "N",
      },
      "CA": {
        "charge": -0.3068,
      },
      "HA": {
        "charge": 0.1447,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0374,
      },
      "HB2": {
        "charge": 0.0371,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0371,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0744,
      },
      "HG2": {
        "charge": 0.0185,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0185,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.1114,
      },
      "HD2": {
        "charge": 0.0468,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0468,
        "parent": "CD",
      },
      "NE": {
        "charge": -0.5564,
      },
      "HE": {
        "charge": 0.3479,
        "parent": "NE",
      },
      "CZ": {
        "charge": 0.8368,
      },
      "NH1": {
        "charge": -0.8737,
      },
      "HH11": {
        "charge": 0.4493,
        "parent": "NH1",
      },
      "HH12": {
        "charge": 0.4493,
        "parent": "NH1",
      },
      "NH2": {
        "charge": -0.8737,
      },
      "HH21": {
        "charge": 0.4493,
        "parent": "NH2",
      },
      "HH22": {
        "charge": 0.4493,
        "parent": "NH2",
      },
      "C": {
        "charge": 0.8557,
      },
      "O": {
        "charge": -0.8266,
      },
      "OXT": {
        "charge": -0.8266,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "1HH1": "HH11",
      "2HH1": "HH12",
      "1HH2": "HH21",
      "2HH2": "HH22",
    },
  },
  "CASN": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.208,
      },
      "HA": {
        "charge": 0.1358,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.2299,
      },
      "HB2": {
        "charge": 0.1023,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1023,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.7153,
      },
      "OD1": {
        "charge": -0.601,
      },
      "ND2": {
        "charge": -0.9084,
      },
      "HD21": {
        "charge": 0.415,
        "parent": "ND2",
      },
      "HD22": {
        "charge": 0.415,
        "parent": "ND2",
      },
      "C": {
        "charge": 0.805,
      },
      "O": {
        "charge": -0.8147,
      },
      "OXT": {
        "charge": -0.8147,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HD2": "HD22",
      "1HD2": "HD21",
    },
  },
  "CASP": {
    "atoms": {
      "N": {
        "charge": -0.5192,
      },
      "H": {
        "charge": 0.3055,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1817,
      },
      "HA": {
        "charge": 0.1046,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0677,
      },
      "HB2": {
        "charge": -0.0212,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0212,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.8851,
      },
      "OD1": {
        "charge": -0.8162,
      },
      "OD2": {
        "charge": -0.8162,
      },
      "C": {
        "charge": 0.7256,
      },
      "O": {
        "charge": -0.7887,
      },
      "OXT": {
        "charge": -0.7887,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CCYS": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1635,
      },
      "HA": {
        "charge": 0.1396,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1996,
      },
      "HB2": {
        "charge": 0.1437,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1437,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.3102,
      },
      "HG": {
        "charge": 0.2068,
        "parent": "SG",
      },
      "C": {
        "charge": 0.7497,
      },
      "O": {
        "charge": -0.7981,
      },
      "OXT": {
        "charge": -0.7981,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HG": "HG",
      "HG1": "HG",
    },
  },
  "CCYX": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1318,
      },
      "HA": {
        "charge": 0.0938,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1943,
      },
      "HB2": {
        "charge": 0.1228,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1228,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.0529,
      },
      "C": {
        "charge": 0.7618,
      },
      "O": {
        "charge": -0.8041,
      },
      "OXT": {
        "charge": -0.8041,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CGLN": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2248,
      },
      "HA": {
        "charge": 0.1232,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0664,
      },
      "HB2": {
        "charge": 0.0452,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0452,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.021,
      },
      "HG2": {
        "charge": 0.0203,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0203,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.7093,
      },
      "OE1": {
        "charge": -0.6098,
      },
      "NE2": {
        "charge": -0.9574,
      },
      "HE21": {
        "charge": 0.4304,
        "parent": "NE2",
      },
      "HE22": {
        "charge": 0.4304,
        "parent": "NE2",
      },
      "C": {
        "charge": 0.7775,
      },
      "O": {
        "charge": -0.8042,
      },
      "OXT": {
        "charge": -0.8042,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE2": "HE21",
      "2HE2": "HE22",
    },
  },
  "CGLU": {
    "atoms": {
      "N": {
        "charge": -0.5192,
      },
      "H": {
        "charge": 0.3055,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2059,
      },
      "HA": {
        "charge": 0.1399,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0071,
      },
      "HB2": {
        "charge": -0.0078,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0078,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0675,
      },
      "HG2": {
        "charge": -0.0548,
        "parent": "CG",
      },
      "HG3": {
        "charge": -0.0548,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.8183,
      },
      "OE1": {
        "charge": -0.822,
      },
      "OE2": {
        "charge": -0.822,
      },
      "C": {
        "charge": 0.742,
      },
      "O": {
        "charge": -0.793,
      },
      "OXT": {
        "charge": -0.793,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
    },
  },
  "CGLY": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2493,
      },
      "HA2": {
        "charge": 0.1056,
        "parent": "CA",
      },
      "HA3": {
        "charge": 0.1056,
        "parent": "CA",
      },
      "C": {
        "charge": 0.7231,
      },
      "O": {
        "charge": -0.7855,
      },
      "OXT": {
        "charge": -0.7855,
      },
    },
    "aliases": {
      "HN": "H",
      "2HA": "HA2",
      "1HA": "HA3",
      "HA1": "HA3",
      "3HA": "HA3",
    },
  },
  "CHID": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1739,
      },
      "HA": {
        "charge": 0.11,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1046,
      },
      "HB2": {
        "charge": 0.0565,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0565,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0293,
      },
      "ND1": {
        "charge": -0.3892,
      },
      "HD1": {
        "charge": 0.3755,
        "parent": "ND1",
      },
      "CE1": {
        "charge": 0.1925,
      },
      "HE1": {
        "charge": 0.1418,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.5629,
      },
      "CD2": {
        "charge": 0.1001,
      },
      "HD2": {
        "charge": 0.1241,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.7615,
      },
      "O": {
        "charge": -0.8016,
      },
      "OXT": {
        "charge": -0.8016,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CHIE": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2699,
      },
      "HA": {
        "charge": 0.165,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1068,
      },
      "HB2": {
        "charge": 0.062,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.062,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.2724,
      },
      "ND1": {
        "charge": -0.5517,
      },
      "CE1": {
        "charge": 0.1558,
      },
      "HE1": {
        "charge": 0.1448,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.267,
      },
      "HE2": {
        "charge": 0.3319,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.2588,
      },
      "HD2": {
        "charge": 0.1957,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.7916,
      },
      "O": {
        "charge": -0.8065,
      },
      "OXT": {
        "charge": -0.8065,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CHIP": {
    "atoms": {
      "N": {
        "charge": -0.3481,
      },
      "H": {
        "charge": 0.2764,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1445,
      },
      "HA": {
        "charge": 0.1115,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.08,
      },
      "HB2": {
        "charge": 0.0868,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0868,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0298,
      },
      "ND1": {
        "charge": -0.1501,
      },
      "HD1": {
        "charge": 0.3883,
        "parent": "ND1",
      },
      "CE1": {
        "charge": -0.0251,
      },
      "HE1": {
        "charge": 0.2694,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.1683,
      },
      "HE2": {
        "charge": 0.3913,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.1256,
      },
      "HD2": {
        "charge": 0.2336,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.8032,
      },
      "O": {
        "charge": -0.8177,
      },
      "OXT": {
        "charge": -0.8177,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "CILE": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.31,
      },
      "HA": {
        "charge": 0.1375,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0363,
      },
      "HB": {
        "charge": 0.0766,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.3498,
      },
      "HG21": {
        "charge": 0.1021,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.1021,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.1021,
        "parent": "CG2",
      },
      "CG1": {
        "charge": -0.0323,
      },
      "HG12": {
        "charge": 0.0321,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0321,
        "parent": "CG1",
      },
      "CD1": {
        "charge": -0.0699,
      },
      "HD11": {
        "charge": 0.0196,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.0196,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.0196,
        "parent": "CD1",
      },
      "C": {
        "charge": 0.8343,
      },
      "O": {
        "charge": -0.819,
      },
      "OXT": {
        "charge": -0.819,
      },
    },
    "aliases": {
      "CD": "CD1",
      "HN": "H",
      "2HG1": "HG12",
      "1HG1": "HG13",
      "HG11": "HG13",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
      "1HD1": "HD11",
      "HD1": "HD11",
      "2HD1": "HD12",
      "HD2": "HD12",
      "3HD1": "HD13",
      "HD3": "HD13",
    },
  },
  "CLEU": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2847,
      },
      "HA": {
        "charge": 0.1346,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.2469,
      },
      "HB2": {
        "charge": 0.0974,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0974,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.3706,
      },
      "HG": {
        "charge": -0.0374,
        "parent": "CG",
      },
      "CD1": {
        "charge": -0.4163,
      },
      "HD11": {
        "charge": 0.1038,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.1038,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.1038,
        "parent": "CD1",
      },
      "CD2": {
        "charge": -0.4163,
      },
      "HD21": {
        "charge": 0.1038,
        "parent": "CD2",
      },
      "HD22": {
        "charge": 0.1038,
        "parent": "CD2",
      },
      "HD23": {
        "charge": 0.1038,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.8326,
      },
      "O": {
        "charge": -0.8199,
      },
      "OXT": {
        "charge": -0.8199,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD1": "HD11",
      "2HD1": "HD12",
      "3HD1": "HD13",
      "1HD2": "HD21",
      "2HD2": "HD22",
      "3HD2": "HD23",
    },
  },
  "CLYS": {
    "atoms": {
      "N": {
        "charge": -0.3481,
      },
      "H": {
        "charge": 0.2764,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2903,
      },
      "HA": {
        "charge": 0.1438,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0538,
      },
      "HB2": {
        "charge": 0.0482,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0482,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0227,
      },
      "HG2": {
        "charge": 0.0134,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0134,
        "parent": "CG",
      },
      "CD": {
        "charge": -0.0392,
      },
      "HD2": {
        "charge": 0.0611,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0611,
        "parent": "CD",
      },
      "CE": {
        "charge": -0.0176,
      },
      "HE2": {
        "charge": 0.1121,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.1121,
        "parent": "CE",
      },
      "NZ": {
        "charge": -0.3741,
      },
      "HZ1": {
        "charge": 0.3374,
        "parent": "NZ",
      },
      "HZ2": {
        "charge": 0.3374,
        "parent": "NZ",
      },
      "HZ3": {
        "charge": 0.3374,
        "parent": "NZ",
      },
      "C": {
        "charge": 0.8488,
      },
      "O": {
        "charge": -0.8252,
      },
      "OXT": {
        "charge": -0.8252,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "2HE": "HE2",
      "1HE": "HE3",
      "HE1": "HE3",
      "3HE": "HE3",
      "1HZ": "HZ1",
      "2HZ": "HZ2",
      "3HZ": "HZ3",
    },
  },
  "CMET": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2597,
      },
      "HA": {
        "charge": 0.1277,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0236,
      },
      "HB2": {
        "charge": 0.048,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.048,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0492,
      },
      "HG2": {
        "charge": 0.0317,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0317,
        "parent": "CG",
      },
      "SD": {
        "charge": -0.2692,
      },
      "CE": {
        "charge": -0.0376,
      },
      "HE1": {
        "charge": 0.0625,
        "parent": "CE",
      },
      "HE2": {
        "charge": 0.0625,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.0625,
        "parent": "CE",
      },
      "C": {
        "charge": 0.8013,
      },
      "O": {
        "charge": -0.8105,
      },
      "OXT": {
        "charge": -0.8105,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE": "HE1",
      "2HE": "HE2",
      "3HE": "HE3",
    },
  },
  "CPHE": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.1825,
      },
      "HA": {
        "charge": 0.1098,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0959,
      },
      "HB2": {
        "charge": 0.0443,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0443,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0552,
      },
      "CD1": {
        "charge": -0.13,
      },
      "HD1": {
        "charge": 0.1408,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.1847,
      },
      "HE1": {
        "charge": 0.1461,
        "parent": "CE1",
      },
      "CZ": {
        "charge": -0.0944,
      },
      "HZ": {
        "charge": 0.128,
        "parent": "CZ",
      },
      "CE2": {
        "charge": -0.1847,
      },
      "HE2": {
        "charge": 0.1461,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.13,
      },
      "HD2": {
        "charge": 0.1408,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.766,
      },
      "O": {
        "charge": -0.8026,
      },
      "OXT": {
        "charge": -0.8026,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "CPRO": {
    "atoms": {
      "N": {
        "charge": -0.2802,
      },
      "CD": {
        "charge": 0.0434,
      },
      "HD2": {
        "charge": 0.0331,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0331,
        "parent": "CD",
      },
      "CG": {
        "charge": 0.0466,
      },
      "HG2": {
        "charge": 0.0172,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0172,
        "parent": "CG",
      },
      "CB": {
        "charge": -0.0543,
      },
      "HB2": {
        "charge": 0.0381,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0381,
        "parent": "CB",
      },
      "CA": {
        "charge": -0.1336,
      },
      "HA": {
        "charge": 0.0776,
        "parent": "CA",
      },
      "C": {
        "charge": 0.6631,
      },
      "O": {
        "charge": -0.7697,
      },
      "OXT": {
        "charge": -0.7697,
      },
    },
    "aliases": {
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
    },
  },
  "CSER": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2722,
      },
      "HA": {
        "charge": 0.1304,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.1123,
      },
      "HB2": {
        "charge": 0.0813,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0813,
        "parent": "CB",
      },
      "OG": {
        "charge": -0.6514,
      },
      "HG": {
        "charge": 0.4474,
        "parent": "OG",
      },
      "C": {
        "charge": 0.8113,
      },
      "O": {
        "charge": -0.8132,
      },
      "OXT": {
        "charge": -0.8132,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "HG1": "HG",
    },
  },
  "CTHR": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.242,
      },
      "HA": {
        "charge": 0.1207,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.3025,
      },
      "HB": {
        "charge": 0.0078,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.1853,
      },
      "HG21": {
        "charge": 0.0586,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0586,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0586,
        "parent": "CG2",
      },
      "OG1": {
        "charge": -0.6496,
      },
      "HG1": {
        "charge": 0.4119,
        "parent": "OG1",
      },
      "C": {
        "charge": 0.781,
      },
      "O": {
        "charge": -0.8044,
      },
      "OXT": {
        "charge": -0.8044,
      },
    },
    "aliases": {
      "HN": "H",
      "1HG": "HG1",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "CTRP": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2084,
      },
      "HA": {
        "charge": 0.1272,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0742,
      },
      "HB2": {
        "charge": 0.0497,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0497,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0796,
      },
      "CD1": {
        "charge": -0.1808,
      },
      "HD1": {
        "charge": 0.2043,
        "parent": "CD1",
      },
      "NE1": {
        "charge": -0.3316,
      },
      "HE1": {
        "charge": 0.3413,
        "parent": "NE1",
      },
      "CE2": {
        "charge": 0.1222,
      },
      "CZ2": {
        "charge": -0.2594,
      },
      "HZ2": {
        "charge": 0.1567,
        "parent": "CZ2",
      },
      "CH2": {
        "charge": -0.102,
      },
      "HH2": {
        "charge": 0.1401,
        "parent": "CH2",
      },
      "CZ3": {
        "charge": -0.2287,
      },
      "HZ3": {
        "charge": 0.1507,
        "parent": "CZ3",
      },
      "CE3": {
        "charge": -0.1837,
      },
      "HE3": {
        "charge": 0.1491,
        "parent": "CE3",
      },
      "CD2": {
        "charge": 0.1078,
      },
      "C": {
        "charge": 0.7658,
      },
      "O": {
        "charge": -0.8011,
      },
      "OXT": {
        "charge": -0.8011,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "1HE": "HE1",
      "3HE": "HE3",
      "2HZ": "HZ2",
      "1HZ": "HZ3",
      "HZ1": "HZ3",
      "3HZ": "HZ3",
      "2HH": "HH2",
    },
  },
  "CTYR": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.2015,
      },
      "HA": {
        "charge": 0.1092,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0752,
      },
      "HB2": {
        "charge": 0.049,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.049,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0243,
      },
      "CD1": {
        "charge": -0.1922,
      },
      "HD1": {
        "charge": 0.178,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.2458,
      },
      "HE1": {
        "charge": 0.1673,
        "parent": "CE1",
      },
      "CZ": {
        "charge": 0.3395,
      },
      "OH": {
        "charge": -0.5643,
      },
      "HH": {
        "charge": 0.4017,
        "parent": "OH",
      },
      "CE2": {
        "charge": -0.2458,
      },
      "HE2": {
        "charge": 0.1673,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.1922,
      },
      "HD2": {
        "charge": 0.178,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.7817,
      },
      "O": {
        "charge": -0.807,
      },
      "OXT": {
        "charge": -0.807,
      },
    },
    "aliases": {
      "HN": "H",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "CVAL": {
    "atoms": {
      "N": {
        "charge": -0.3821,
      },
      "H": {
        "charge": 0.2681,
        "parent": "N",
      },
      "CA": {
        "charge": -0.3438,
      },
      "HA": {
        "charge": 0.1438,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.194,
      },
      "HB": {
        "charge": 0.0308,
        "parent": "CB",
      },
      "CG1": {
        "charge": -0.3064,
      },
      "HG11": {
        "charge": 0.0836,
        "parent": "CG1",
      },
      "HG12": {
        "charge": 0.0836,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0836,
        "parent": "CG1",
      },
      "CG2": {
        "charge": -0.3064,
      },
      "HG21": {
        "charge": 0.0836,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0836,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0836,
        "parent": "CG2",
      },
      "C": {
        "charge": 0.835,
      },
      "O": {
        "charge": -0.8173,
      },
      "OXT": {
        "charge": -0.8173,
      },
    },
    "aliases": {
      "HN": "H",
      "1HG1": "HG11",
      "2HG1": "HG12",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "NHE": {
    "atoms": {
      "N": {
        "charge": -0.463,
      },
      "HN1": {
        "charge": 0.2315,
      },
      "HN2": {
        "charge": 0.2315,
      },
    },
    "aliases": {},
  },
  "NME": {
    "atoms": {
      "N": {
        "charge": -0.4157,
      },
      "H": {
        "charge": 0.2719,
      },
      "CH3": {
        "charge": -0.149,
      },
      "HH31": {
        "charge": 0.0976,
      },
      "HH32": {
        "charge": 0.0976,
      },
      "HH33": {
        "charge": 0.0976,
      },
    },
    "aliases": {},
  },
  "ACE": {
    "atoms": {
      "HH31": {
        "charge": 0.1123,
      },
      "CH3": {
        "charge": -0.3662,
      },
      "HH32": {
        "charge": 0.1123,
      },
      "HH33": {
        "charge": 0.1123,
      },
      "C": {
        "charge": 0.5972,
      },
      "O": {
        "charge": -0.5679,
      },
    },
    "aliases": {},
  },
  "NALA": {
    "atoms": {
      "N": {
        "charge": 0.1414,
      },
      "H1": {
        "charge": 0.1997,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1997,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1997,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0962,
      },
      "HA": {
        "charge": 0.0889,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0597,
      },
      "HB1": {
        "charge": 0.03,
        "parent": "CB",
      },
      "HB2": {
        "charge": 0.03,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.03,
        "parent": "CB",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "1HB": "HB1",
      "2HB": "HB2",
      "3HB": "HB3",
    },
  },
  "NARG": {
    "atoms": {
      "N": {
        "charge": 0.1305,
      },
      "H1": {
        "charge": 0.2083,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2083,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2083,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0223,
      },
      "HA": {
        "charge": 0.1242,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0118,
      },
      "HB2": {
        "charge": 0.0226,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0226,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0236,
      },
      "HG2": {
        "charge": 0.0309,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0309,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.0935,
      },
      "HD2": {
        "charge": 0.0527,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0527,
        "parent": "CD",
      },
      "NE": {
        "charge": -0.565,
      },
      "HE": {
        "charge": 0.3592,
        "parent": "NE",
      },
      "CZ": {
        "charge": 0.8281,
      },
      "NH1": {
        "charge": -0.8693,
      },
      "HH11": {
        "charge": 0.4494,
        "parent": "NH1",
      },
      "HH12": {
        "charge": 0.4494,
        "parent": "NH1",
      },
      "NH2": {
        "charge": -0.8693,
      },
      "HH21": {
        "charge": 0.4494,
        "parent": "NH2",
      },
      "HH22": {
        "charge": 0.4494,
        "parent": "NH2",
      },
      "C": {
        "charge": 0.7214,
      },
      "O": {
        "charge": -0.6013,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "1HH1": "HH11",
      "2HH1": "HH12",
      "1HH2": "HH21",
      "2HH2": "HH22",
    },
  },
  "NASN": {
    "atoms": {
      "N": {
        "charge": 0.1801,
      },
      "H1": {
        "charge": 0.1921,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1921,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1921,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0368,
      },
      "HA": {
        "charge": 0.1231,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0283,
      },
      "HB2": {
        "charge": 0.0515,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0515,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.5833,
      },
      "OD1": {
        "charge": -0.5744,
      },
      "ND2": {
        "charge": -0.8634,
      },
      "HD21": {
        "charge": 0.4097,
        "parent": "ND2",
      },
      "HD22": {
        "charge": 0.4097,
        "parent": "ND2",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HD2": "HD22",
      "1HD2": "HD21",
    },
  },
  "NASP": {
    "atoms": {
      "N": {
        "charge": 0.0782,
      },
      "H1": {
        "charge": 0.22,
        "parent": "N",
      },
      "H2": {
        "charge": 0.22,
        "parent": "N",
      },
      "H3": {
        "charge": 0.22,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0292,
      },
      "HA": {
        "charge": 0.1141,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0235,
      },
      "HB2": {
        "charge": -0.0169,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0169,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.8194,
      },
      "OD1": {
        "charge": -0.8084,
      },
      "OD2": {
        "charge": -0.8084,
      },
      "C": {
        "charge": 0.5621,
      },
      "O": {
        "charge": -0.5889,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "NCYS": {
    "atoms": {
      "N": {
        "charge": 0.1325,
      },
      "H1": {
        "charge": 0.2023,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2023,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2023,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0927,
      },
      "HA": {
        "charge": 0.1411,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.1195,
      },
      "HB2": {
        "charge": 0.1188,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1188,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.3298,
      },
      "HG": {
        "charge": 0.1975,
        "parent": "SG",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HG": "HG",
      "HG1": "HG",
    },
  },
  "NCYX": {
    "atoms": {
      "N": {
        "charge": 0.2069,
      },
      "H1": {
        "charge": 0.1815,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1815,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1815,
        "parent": "N",
      },
      "CA": {
        "charge": 0.1055,
      },
      "HA": {
        "charge": 0.0922,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0277,
      },
      "HB2": {
        "charge": 0.068,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.068,
        "parent": "CB",
      },
      "SG": {
        "charge": -0.0984,
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "NGLN": {
    "atoms": {
      "N": {
        "charge": 0.1493,
      },
      "H1": {
        "charge": 0.1996,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1996,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1996,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0536,
      },
      "HA": {
        "charge": 0.1015,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0651,
      },
      "HB2": {
        "charge": 0.005,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.005,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0903,
      },
      "HG2": {
        "charge": 0.0331,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0331,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.7354,
      },
      "OE1": {
        "charge": -0.6133,
      },
      "NE2": {
        "charge": -1.0031,
      },
      "HE21": {
        "charge": 0.4429,
        "parent": "NE2",
      },
      "HE22": {
        "charge": 0.4429,
        "parent": "NE2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE2": "HE21",
      "2HE2": "HE22",
    },
  },
  "NGLU": {
    "atoms": {
      "N": {
        "charge": 0.0017,
      },
      "H1": {
        "charge": 0.2391,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2391,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2391,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0588,
      },
      "HA": {
        "charge": 0.1202,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0909,
      },
      "HB2": {
        "charge": -0.0232,
        "parent": "CB",
      },
      "HB3": {
        "charge": -0.0232,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0236,
      },
      "HG2": {
        "charge": -0.0315,
        "parent": "CG",
      },
      "HG3": {
        "charge": -0.0315,
        "parent": "CG",
      },
      "CD": {
        "charge": 0.8087,
      },
      "OE1": {
        "charge": -0.8189,
      },
      "OE2": {
        "charge": -0.8189,
      },
      "C": {
        "charge": 0.5621,
      },
      "O": {
        "charge": -0.5889,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
    },
  },
  "NGLY": {
    "atoms": {
      "N": {
        "charge": 0.2943,
      },
      "H1": {
        "charge": 0.1642,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1642,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1642,
        "parent": "N",
      },
      "CA": {
        "charge": -0.01,
      },
      "HA2": {
        "charge": 0.0895,
        "parent": "CA",
      },
      "HA3": {
        "charge": 0.0895,
        "parent": "CA",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HA": "HA2",
      "1HA": "HA3",
      "HA1": "HA3",
      "3HA": "HA3",
    },
  },
  "NHID": {
    "atoms": {
      "N": {
        "charge": 0.1542,
      },
      "H1": {
        "charge": 0.1963,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1963,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1963,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0964,
      },
      "HA": {
        "charge": 0.0958,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0259,
      },
      "HB2": {
        "charge": 0.0209,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0209,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0399,
      },
      "ND1": {
        "charge": -0.3819,
      },
      "HD1": {
        "charge": 0.3632,
        "parent": "ND1",
      },
      "CE1": {
        "charge": 0.2127,
      },
      "HE1": {
        "charge": 0.1385,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.5711,
      },
      "CD2": {
        "charge": 0.1046,
      },
      "HD2": {
        "charge": 0.1299,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "NHIE": {
    "atoms": {
      "N": {
        "charge": 0.1472,
      },
      "H1": {
        "charge": 0.2016,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2016,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2016,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0236,
      },
      "HA": {
        "charge": 0.138,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0489,
      },
      "HB2": {
        "charge": 0.0223,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0223,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.174,
      },
      "ND1": {
        "charge": -0.5579,
      },
      "CE1": {
        "charge": 0.1804,
      },
      "HE1": {
        "charge": 0.1397,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.2781,
      },
      "HE2": {
        "charge": 0.3324,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.2349,
      },
      "HD2": {
        "charge": 0.1963,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "NHIP": {
    "atoms": {
      "N": {
        "charge": 0.256,
      },
      "H1": {
        "charge": 0.1704,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1704,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1704,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0581,
      },
      "HA": {
        "charge": 0.1047,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0484,
      },
      "HB2": {
        "charge": 0.0531,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0531,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0236,
      },
      "ND1": {
        "charge": -0.151,
      },
      "HD1": {
        "charge": 0.3821,
        "parent": "ND1",
      },
      "CE1": {
        "charge": -0.0011,
      },
      "HE1": {
        "charge": 0.2645,
        "parent": "CE1",
      },
      "NE2": {
        "charge": -0.1739,
      },
      "HE2": {
        "charge": 0.3921,
        "parent": "NE2",
      },
      "CD2": {
        "charge": -0.1433,
      },
      "HD2": {
        "charge": 0.2495,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.7214,
      },
      "O": {
        "charge": -0.6013,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
    },
  },
  "NILE": {
    "atoms": {
      "N": {
        "charge": 0.0311,
      },
      "H1": {
        "charge": 0.2329,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2329,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2329,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0257,
      },
      "HA": {
        "charge": 0.1031,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.1885,
      },
      "HB": {
        "charge": 0.0213,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.372,
      },
      "HG21": {
        "charge": 0.0947,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0947,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0947,
        "parent": "CG2",
      },
      "CG1": {
        "charge": -0.0387,
      },
      "HG12": {
        "charge": 0.0201,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0201,
        "parent": "CG1",
      },
      "CD1": {
        "charge": -0.0908,
      },
      "HD11": {
        "charge": 0.0226,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.0226,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.0226,
        "parent": "CD1",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "CD": "CD1",
      "H": "H1",
      "HN": "H1",
      "2HG1": "HG12",
      "1HG1": "HG13",
      "HG11": "HG13",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
      "1HD1": "HD11",
      "HD1": "HD11",
      "2HD1": "HD12",
      "HD2": "HD12",
      "3HD1": "HD13",
      "HD3": "HD13",
    },
  },
  "NLEU": {
    "atoms": {
      "N": {
        "charge": 0.101,
      },
      "H1": {
        "charge": 0.2148,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2148,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2148,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0104,
      },
      "HA": {
        "charge": 0.1053,
        "parent": "CA",
      },
      "CB": {
        "charge": -0.0244,
      },
      "HB2": {
        "charge": 0.0256,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0256,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.3421,
      },
      "HG": {
        "charge": -0.038,
        "parent": "CG",
      },
      "CD1": {
        "charge": -0.4106,
      },
      "HD11": {
        "charge": 0.098,
        "parent": "CD1",
      },
      "HD12": {
        "charge": 0.098,
        "parent": "CD1",
      },
      "HD13": {
        "charge": 0.098,
        "parent": "CD1",
      },
      "CD2": {
        "charge": -0.4104,
      },
      "HD21": {
        "charge": 0.098,
        "parent": "CD2",
      },
      "HD22": {
        "charge": 0.098,
        "parent": "CD2",
      },
      "HD23": {
        "charge": 0.098,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD1": "HD11",
      "2HD1": "HD12",
      "3HD1": "HD13",
      "1HD2": "HD21",
      "2HD2": "HD22",
      "3HD2": "HD23",
    },
  },
  "NLYS": {
    "atoms": {
      "N": {
        "charge": 0.0966,
      },
      "H1": {
        "charge": 0.2165,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2165,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2165,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0015,
      },
      "HA": {
        "charge": 0.118,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0212,
      },
      "HB2": {
        "charge": 0.0283,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0283,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0048,
      },
      "HG2": {
        "charge": 0.0121,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0121,
        "parent": "CG",
      },
      "CD": {
        "charge": -0.0608,
      },
      "HD2": {
        "charge": 0.0633,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.0633,
        "parent": "CD",
      },
      "CE": {
        "charge": -0.0181,
      },
      "HE2": {
        "charge": 0.1171,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.1171,
        "parent": "CE",
      },
      "NZ": {
        "charge": -0.3764,
      },
      "HZ1": {
        "charge": 0.3382,
        "parent": "NZ",
      },
      "HZ2": {
        "charge": 0.3382,
        "parent": "NZ",
      },
      "HZ3": {
        "charge": 0.3382,
        "parent": "NZ",
      },
      "C": {
        "charge": 0.7214,
      },
      "O": {
        "charge": -0.6013,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
      "2HE": "HE2",
      "1HE": "HE3",
      "HE1": "HE3",
      "3HE": "HE3",
      "1HZ": "HZ1",
      "2HZ": "HZ2",
      "3HZ": "HZ3",
    },
  },
  "NMET": {
    "atoms": {
      "N": {
        "charge": 0.1592,
      },
      "H1": {
        "charge": 0.1984,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1984,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1984,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0221,
      },
      "HA": {
        "charge": 0.1116,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0865,
      },
      "HB2": {
        "charge": 0.0125,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0125,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0334,
      },
      "HG2": {
        "charge": 0.0292,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.0292,
        "parent": "CG",
      },
      "SD": {
        "charge": -0.2774,
      },
      "CE": {
        "charge": -0.0341,
      },
      "HE1": {
        "charge": 0.0597,
        "parent": "CE",
      },
      "HE2": {
        "charge": 0.0597,
        "parent": "CE",
      },
      "HE3": {
        "charge": 0.0597,
        "parent": "CE",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "1HE": "HE1",
      "2HE": "HE2",
      "3HE": "HE3",
    },
  },
  "NPHE": {
    "atoms": {
      "N": {
        "charge": 0.1737,
      },
      "H1": {
        "charge": 0.1921,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1921,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1921,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0733,
      },
      "HA": {
        "charge": 0.1041,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.033,
      },
      "HB2": {
        "charge": 0.0104,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0104,
        "parent": "CB",
      },
      "CG": {
        "charge": 0.0031,
      },
      "CD1": {
        "charge": -0.1392,
      },
      "HD1": {
        "charge": 0.1374,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.1602,
      },
      "HE1": {
        "charge": 0.1433,
        "parent": "CE1",
      },
      "CZ": {
        "charge": -0.1208,
      },
      "HZ": {
        "charge": 0.1329,
        "parent": "CZ",
      },
      "CE2": {
        "charge": -0.1603,
      },
      "HE2": {
        "charge": 0.1433,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.1391,
      },
      "HD2": {
        "charge": 0.1374,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "NPRO": {
    "atoms": {
      "N": {
        "charge": -0.202,
      },
      "H2": {
        "charge": 0.312,
        "parent": "N",
      },
      "H3": {
        "charge": 0.312,
        "parent": "N",
      },
      "CD": {
        "charge": -0.012,
      },
      "HD2": {
        "charge": 0.1,
        "parent": "CD",
      },
      "HD3": {
        "charge": 0.1,
        "parent": "CD",
      },
      "CG": {
        "charge": -0.121,
      },
      "HG2": {
        "charge": 0.1,
        "parent": "CG",
      },
      "HG3": {
        "charge": 0.1,
        "parent": "CG",
      },
      "CB": {
        "charge": -0.115,
      },
      "HB2": {
        "charge": 0.1,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.1,
        "parent": "CB",
      },
      "CA": {
        "charge": 0.1,
      },
      "HA": {
        "charge": 0.1,
        "parent": "CA",
      },
      "C": {
        "charge": 0.526,
      },
      "O": {
        "charge": -0.5,
      },
    },
    "aliases": {
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "2HG": "HG2",
      "1HG": "HG3",
      "HG1": "HG3",
      "3HG": "HG3",
      "2HD": "HD2",
      "1HD": "HD3",
      "HD1": "HD3",
      "3HD": "HD3",
    },
  },
  "NSER": {
    "atoms": {
      "N": {
        "charge": 0.1849,
      },
      "H1": {
        "charge": 0.1898,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1898,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1898,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0567,
      },
      "HA": {
        "charge": 0.0782,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.2596,
      },
      "HB2": {
        "charge": 0.0273,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0273,
        "parent": "CB",
      },
      "OG": {
        "charge": -0.6714,
      },
      "HG": {
        "charge": 0.4239,
        "parent": "OG",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "HG1": "HG",
    },
  },
  "NTHR": {
    "atoms": {
      "N": {
        "charge": 0.1812,
      },
      "H1": {
        "charge": 0.1934,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1934,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1934,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0034,
      },
      "HA": {
        "charge": 0.1087,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.4514,
      },
      "HB": {
        "charge": -0.0323,
        "parent": "CB",
      },
      "CG2": {
        "charge": -0.2554,
      },
      "HG21": {
        "charge": 0.0627,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0627,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0627,
        "parent": "CG2",
      },
      "OG1": {
        "charge": -0.6764,
      },
      "HG1": {
        "charge": 0.407,
        "parent": "OG1",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "1HG": "HG1",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "NTRP": {
    "atoms": {
      "N": {
        "charge": 0.1913,
      },
      "H1": {
        "charge": 0.1888,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1888,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1888,
        "parent": "N",
      },
      "CA": {
        "charge": 0.0421,
      },
      "HA": {
        "charge": 0.1162,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0543,
      },
      "HB2": {
        "charge": 0.0222,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0222,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.1654,
      },
      "CD1": {
        "charge": -0.1788,
      },
      "HD1": {
        "charge": 0.2195,
        "parent": "CD1",
      },
      "NE1": {
        "charge": -0.3444,
      },
      "HE1": {
        "charge": 0.3412,
        "parent": "NE1",
      },
      "CE2": {
        "charge": 0.1575,
      },
      "CZ2": {
        "charge": -0.271,
      },
      "HZ2": {
        "charge": 0.1589,
        "parent": "CZ2",
      },
      "CH2": {
        "charge": -0.108,
      },
      "HH2": {
        "charge": 0.1411,
        "parent": "CH2",
      },
      "CZ3": {
        "charge": -0.2034,
      },
      "HZ3": {
        "charge": 0.1458,
        "parent": "CZ3",
      },
      "CE3": {
        "charge": -0.2265,
      },
      "HE3": {
        "charge": 0.1646,
        "parent": "CE3",
      },
      "CD2": {
        "charge": 0.1132,
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "1HE": "HE1",
      "3HE": "HE3",
      "2HZ": "HZ2",
      "1HZ": "HZ3",
      "HZ1": "HZ3",
      "3HZ": "HZ3",
      "2HH": "HH2",
    },
  },
  "NTYR": {
    "atoms": {
      "N": {
        "charge": 0.194,
      },
      "H1": {
        "charge": 0.1873,
        "parent": "N",
      },
      "H2": {
        "charge": 0.1873,
        "parent": "N",
      },
      "H3": {
        "charge": 0.1873,
        "parent": "N",
      },
      "CA": {
        "charge": 0.057,
      },
      "HA": {
        "charge": 0.0983,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.0659,
      },
      "HB2": {
        "charge": 0.0102,
        "parent": "CB",
      },
      "HB3": {
        "charge": 0.0102,
        "parent": "CB",
      },
      "CG": {
        "charge": -0.0205,
      },
      "CD1": {
        "charge": -0.2002,
      },
      "HD1": {
        "charge": 0.172,
        "parent": "CD1",
      },
      "CE1": {
        "charge": -0.2239,
      },
      "HE1": {
        "charge": 0.165,
        "parent": "CE1",
      },
      "CZ": {
        "charge": 0.3139,
      },
      "OH": {
        "charge": -0.5578,
      },
      "HH": {
        "charge": 0.4001,
        "parent": "OH",
      },
      "CE2": {
        "charge": -0.2239,
      },
      "HE2": {
        "charge": 0.165,
        "parent": "CE2",
      },
      "CD2": {
        "charge": -0.2002,
      },
      "HD2": {
        "charge": 0.172,
        "parent": "CD2",
      },
      "C": {
        "charge": 0.6123,
      },
      "O": {
        "charge": -0.5713,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "2HB": "HB2",
      "1HB": "HB3",
      "HB1": "HB3",
      "3HB": "HB3",
      "1HD": "HD1",
      "2HD": "HD2",
      "1HE": "HE1",
      "2HE": "HE2",
    },
  },
  "NVAL": {
    "atoms": {
      "N": {
        "charge": 0.0577,
      },
      "H1": {
        "charge": 0.2272,
        "parent": "N",
      },
      "H2": {
        "charge": 0.2272,
        "parent": "N",
      },
      "H3": {
        "charge": 0.2272,
        "parent": "N",
      },
      "CA": {
        "charge": -0.0054,
      },
      "HA": {
        "charge": 0.1093,
        "parent": "CA",
      },
      "CB": {
        "charge": 0.3196,
      },
      "HB": {
        "charge": -0.0221,
        "parent": "CB",
      },
      "CG1": {
        "charge": -0.3129,
      },
      "HG11": {
        "charge": 0.0735,
        "parent": "CG1",
      },
      "HG12": {
        "charge": 0.0735,
        "parent": "CG1",
      },
      "HG13": {
        "charge": 0.0735,
        "parent": "CG1",
      },
      "CG2": {
        "charge": -0.3129,
      },
      "HG21": {
        "charge": 0.0735,
        "parent": "CG2",
      },
      "HG22": {
        "charge": 0.0735,
        "parent": "CG2",
      },
      "HG23": {
        "charge": 0.0735,
        "parent": "CG2",
      },
      "C": {
        "charge": 0.6163,
      },
      "O": {
        "charge": -0.5722,
      },
    },
    "aliases": {
      "H": "H1",
      "HN": "H1",
      "1HG1": "HG11",
      "2HG1": "HG12",
      "3HG1": "HG13",
      "1HG2": "HG21",
      "2HG2": "HG22",
      "3HG2": "HG23",
    },
  },
  "DA": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0431,
      },
      "H1'": {
        "charge": 0.1838,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0268,
      },
      "C8": {
        "charge": 0.1607,
      },
      "H8": {
        "charge": 0.1877,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6175,
      },
      "C5": {
        "charge": 0.0725,
      },
      "C6": {
        "charge": 0.6897,
      },
      "N6": {
        "charge": -0.9123,
      },
      "H61": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7624,
      },
      "C2": {
        "charge": 0.5716,
      },
      "H2": {
        "charge": 0.0598,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.7417,
      },
      "C4": {
        "charge": 0.38,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "H2*2": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DA3": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0431,
      },
      "H1'": {
        "charge": 0.1838,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0268,
      },
      "C8": {
        "charge": 0.1607,
      },
      "H8": {
        "charge": 0.1877,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6175,
      },
      "C5": {
        "charge": 0.0725,
      },
      "C6": {
        "charge": 0.6897,
      },
      "N6": {
        "charge": -0.9123,
      },
      "H61": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7624,
      },
      "C2": {
        "charge": 0.5716,
      },
      "H2": {
        "charge": 0.0598,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.7417,
      },
      "C4": {
        "charge": 0.38,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "H2*2": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DA5": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0431,
      },
      "H1'": {
        "charge": 0.1838,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0268,
      },
      "C8": {
        "charge": 0.1607,
      },
      "H8": {
        "charge": 0.1877,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6175,
      },
      "C5": {
        "charge": 0.0725,
      },
      "C6": {
        "charge": 0.6897,
      },
      "N6": {
        "charge": -0.9123,
      },
      "H61": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7624,
      },
      "C2": {
        "charge": 0.5716,
      },
      "H2": {
        "charge": 0.0598,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.7417,
      },
      "C4": {
        "charge": 0.38,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "H2*2": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DAN": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
      },
      "H5'2": {
        "charge": 0.0754,
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0431,
      },
      "H1'": {
        "charge": 0.1838,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0268,
      },
      "C8": {
        "charge": 0.1607,
      },
      "H8": {
        "charge": 0.1877,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6175,
      },
      "C5": {
        "charge": 0.0725,
      },
      "C6": {
        "charge": 0.6897,
      },
      "N6": {
        "charge": -0.9123,
      },
      "H61": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4167,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7624,
      },
      "C2": {
        "charge": 0.5716,
      },
      "H2": {
        "charge": 0.0598,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.7417,
      },
      "C4": {
        "charge": 0.38,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DC": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": -0.0116,
      },
      "H1'": {
        "charge": 0.1963,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0339,
      },
      "C6": {
        "charge": -0.0183,
      },
      "H6": {
        "charge": 0.2293,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5222,
      },
      "H5": {
        "charge": 0.1863,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8439,
      },
      "N4": {
        "charge": -0.9773,
      },
      "H41": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7748,
      },
      "C2": {
        "charge": 0.7959,
      },
      "O2": {
        "charge": -0.6548,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DC3": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": -0.0116,
      },
      "H1'": {
        "charge": 0.1963,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0339,
      },
      "C6": {
        "charge": -0.0183,
      },
      "H6": {
        "charge": 0.2293,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5222,
      },
      "H5": {
        "charge": 0.1863,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8439,
      },
      "N4": {
        "charge": -0.9773,
      },
      "H41": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7748,
      },
      "C2": {
        "charge": 0.7959,
      },
      "O2": {
        "charge": -0.6548,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DC5": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": -0.0116,
      },
      "H1'": {
        "charge": 0.1963,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0339,
      },
      "C6": {
        "charge": -0.0183,
      },
      "H6": {
        "charge": 0.2293,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5222,
      },
      "H5": {
        "charge": 0.1863,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8439,
      },
      "N4": {
        "charge": -0.9773,
      },
      "H41": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7748,
      },
      "C2": {
        "charge": 0.7959,
      },
      "O2": {
        "charge": -0.6548,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DCN": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
      },
      "H5'2": {
        "charge": 0.0754,
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": -0.0116,
      },
      "H1'": {
        "charge": 0.1963,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0339,
      },
      "C6": {
        "charge": -0.0183,
      },
      "H6": {
        "charge": 0.2293,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5222,
      },
      "H5": {
        "charge": 0.1863,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8439,
      },
      "N4": {
        "charge": -0.9773,
      },
      "H41": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4314,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7748,
      },
      "C2": {
        "charge": 0.7959,
      },
      "O2": {
        "charge": -0.6548,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DG": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0358,
      },
      "H1'": {
        "charge": 0.1746,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0577,
      },
      "C8": {
        "charge": 0.0736,
      },
      "H8": {
        "charge": 0.1997,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5725,
      },
      "C5": {
        "charge": 0.1991,
      },
      "C6": {
        "charge": 0.4918,
      },
      "O6": {
        "charge": -0.5699,
      },
      "N1": {
        "charge": -0.5053,
      },
      "H1": {
        "charge": 0.352,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7432,
      },
      "N2": {
        "charge": -0.923,
      },
      "H21": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6636,
      },
      "C4": {
        "charge": 0.1814,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DG3": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0358,
      },
      "H1'": {
        "charge": 0.1746,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0577,
      },
      "C8": {
        "charge": 0.0736,
      },
      "H8": {
        "charge": 0.1997,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5725,
      },
      "C5": {
        "charge": 0.1991,
      },
      "C6": {
        "charge": 0.4918,
      },
      "O6": {
        "charge": -0.5699,
      },
      "N1": {
        "charge": -0.5053,
      },
      "H1": {
        "charge": 0.352,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7432,
      },
      "N2": {
        "charge": -0.923,
      },
      "H21": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6636,
      },
      "C4": {
        "charge": 0.1814,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DG5": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0358,
      },
      "H1'": {
        "charge": 0.1746,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0577,
      },
      "C8": {
        "charge": 0.0736,
      },
      "H8": {
        "charge": 0.1997,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5725,
      },
      "C5": {
        "charge": 0.1991,
      },
      "C6": {
        "charge": 0.4918,
      },
      "O6": {
        "charge": -0.5699,
      },
      "N1": {
        "charge": -0.5053,
      },
      "H1": {
        "charge": 0.352,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7432,
      },
      "N2": {
        "charge": -0.923,
      },
      "H21": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6636,
      },
      "C4": {
        "charge": 0.1814,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "HO'2": "H2'2",
      "HO*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "2HO'": "H2'2",
      "2HO*": "H2'2",
      "HO2'": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DGN": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
      },
      "H5'2": {
        "charge": 0.0754,
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.0358,
      },
      "H1'": {
        "charge": 0.1746,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0577,
      },
      "C8": {
        "charge": 0.0736,
      },
      "H8": {
        "charge": 0.1997,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5725,
      },
      "C5": {
        "charge": 0.1991,
      },
      "C6": {
        "charge": 0.4918,
      },
      "O6": {
        "charge": -0.5699,
      },
      "N1": {
        "charge": -0.5053,
      },
      "H1": {
        "charge": 0.352,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7432,
      },
      "N2": {
        "charge": -0.923,
      },
      "H21": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4235,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6636,
      },
      "C4": {
        "charge": 0.1814,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DT": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.068,
      },
      "H1'": {
        "charge": 0.1804,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0239,
      },
      "C6": {
        "charge": -0.2209,
      },
      "H6": {
        "charge": 0.2607,
        "parent": "C6",
      },
      "C5": {
        "charge": 0.0025,
      },
      "C7": {
        "charge": -0.2269,
      },
      "H71": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H72": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H73": {
        "charge": 0.077,
        "parent": "C7",
      },
      "C4": {
        "charge": 0.5194,
      },
      "O4": {
        "charge": -0.5563,
      },
      "N3": {
        "charge": -0.434,
      },
      "H3": {
        "charge": 0.342,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.5677,
      },
      "O2": {
        "charge": -0.5881,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C5M": "C7",
      "H51": "H71",
      "H52": "H72",
      "2H7": "H72",
      "2H5": "H72",
      "H53": "H73",
      "3H5": "H73",
      "3H7": "H73",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DT3": {
    "atoms": {
      "P": {
        "charge": 1.1659,
      },
      "O1P": {
        "charge": -0.7761,
      },
      "O2P": {
        "charge": -0.7761,
      },
      "O5'": {
        "charge": -0.4954,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.068,
      },
      "H1'": {
        "charge": 0.1804,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0239,
      },
      "C6": {
        "charge": -0.2209,
      },
      "H6": {
        "charge": 0.2607,
        "parent": "C6",
      },
      "C5": {
        "charge": 0.0025,
      },
      "C7": {
        "charge": -0.2269,
      },
      "H71": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H72": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H73": {
        "charge": 0.077,
        "parent": "C7",
      },
      "C4": {
        "charge": 0.5194,
      },
      "O4": {
        "charge": -0.5563,
      },
      "N3": {
        "charge": -0.434,
      },
      "H3": {
        "charge": 0.342,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.5677,
      },
      "O2": {
        "charge": -0.5881,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C5M": "C7",
      "H51": "H71",
      "H52": "H72",
      "2H7": "H72",
      "2H5": "H72",
      "H53": "H73",
      "3H5": "H73",
      "3H7": "H73",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DT5": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0754,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.068,
      },
      "H1'": {
        "charge": 0.1804,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0239,
      },
      "C6": {
        "charge": -0.2209,
      },
      "H6": {
        "charge": 0.2607,
        "parent": "C6",
      },
      "C5": {
        "charge": 0.0025,
      },
      "C7": {
        "charge": -0.2269,
      },
      "H71": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H72": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H73": {
        "charge": 0.077,
        "parent": "C7",
      },
      "C4": {
        "charge": 0.5194,
      },
      "O4": {
        "charge": -0.5563,
      },
      "N3": {
        "charge": -0.434,
      },
      "H3": {
        "charge": 0.342,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.5677,
      },
      "O2": {
        "charge": -0.5881,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.5232,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C5M": "C7",
      "H51": "H71",
      "H52": "H72",
      "2H7": "H72",
      "2H5": "H72",
      "H53": "H73",
      "3H5": "H73",
      "3H7": "H73",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "H2''": "H2'2",
      "H2**": "H2'2",
      "H2*2": "H2'2",
      "2H2'": "H2'2",
      "2H2*": "H2'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "DTN": {
    "atoms": {
      "H5T": {
        "charge": 0.4422,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6318,
      },
      "C5'": {
        "charge": -0.0069,
      },
      "H5'1": {
        "charge": 0.0754,
      },
      "H5'2": {
        "charge": 0.0754,
      },
      "C4'": {
        "charge": 0.1629,
      },
      "H4'": {
        "charge": 0.1176,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3691,
      },
      "C1'": {
        "charge": 0.068,
      },
      "H1'": {
        "charge": 0.1804,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0239,
      },
      "C6": {
        "charge": -0.2209,
      },
      "H6": {
        "charge": 0.2607,
        "parent": "C6",
      },
      "C5": {
        "charge": 0.0025,
      },
      "C7": {
        "charge": -0.2269,
      },
      "H71": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H72": {
        "charge": 0.077,
        "parent": "C7",
      },
      "H73": {
        "charge": 0.077,
        "parent": "C7",
      },
      "C4": {
        "charge": 0.5194,
      },
      "O4": {
        "charge": -0.5563,
      },
      "N3": {
        "charge": -0.434,
      },
      "H3": {
        "charge": 0.342,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.5677,
      },
      "O2": {
        "charge": -0.5881,
      },
      "C3'": {
        "charge": 0.0713,
      },
      "H3'": {
        "charge": 0.0985,
        "parent": "C3'",
      },
      "C2'": {
        "charge": -0.0854,
      },
      "H2'1": {
        "charge": 0.0718,
      },
      "H2'2": {
        "charge": 0.0718,
        "parent": "C2'",
      },
      "O3'": {
        "charge": -0.6549,
      },
      "H3T": {
        "charge": 0.4396,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C5M": "C7",
      "H51": "H71",
      "H52": "H72",
      "2H7": "H72",
      "2H5": "H72",
      "H53": "H73",
      "3H5": "H73",
      "3H7": "H73",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RA": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0394,
      },
      "H1'": {
        "charge": 0.2007,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0251,
      },
      "C8": {
        "charge": 0.2006,
      },
      "H8": {
        "charge": 0.1553,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6073,
      },
      "C5": {
        "charge": 0.0515,
      },
      "C6": {
        "charge": 0.7009,
      },
      "N6": {
        "charge": -0.9019,
      },
      "H61": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7615,
      },
      "C2": {
        "charge": 0.5875,
      },
      "H2": {
        "charge": 0.0473,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.6997,
      },
      "C4": {
        "charge": 0.3053,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RA3": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0394,
      },
      "H1'": {
        "charge": 0.2007,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0251,
      },
      "C8": {
        "charge": 0.2006,
      },
      "H8": {
        "charge": 0.1553,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6073,
      },
      "C5": {
        "charge": 0.0515,
      },
      "C6": {
        "charge": 0.7009,
      },
      "N6": {
        "charge": -0.9019,
      },
      "H61": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7615,
      },
      "C2": {
        "charge": 0.5875,
      },
      "H2": {
        "charge": 0.0473,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.6997,
      },
      "C4": {
        "charge": 0.3053,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RA5": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0394,
      },
      "H1'": {
        "charge": 0.2007,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0251,
      },
      "C8": {
        "charge": 0.2006,
      },
      "H8": {
        "charge": 0.1553,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6073,
      },
      "C5": {
        "charge": 0.0515,
      },
      "C6": {
        "charge": 0.7009,
      },
      "N6": {
        "charge": -0.9019,
      },
      "H61": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7615,
      },
      "C2": {
        "charge": 0.5875,
      },
      "H2": {
        "charge": 0.0473,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.6997,
      },
      "C4": {
        "charge": 0.3053,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RAN": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
      },
      "H5'2": {
        "charge": 0.0679,
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0394,
      },
      "H1'": {
        "charge": 0.2007,
        "parent": "C1'",
      },
      "N9": {
        "charge": -0.0251,
      },
      "C8": {
        "charge": 0.2006,
      },
      "H8": {
        "charge": 0.1553,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.6073,
      },
      "C5": {
        "charge": 0.0515,
      },
      "C6": {
        "charge": 0.7009,
      },
      "N6": {
        "charge": -0.9019,
      },
      "H61": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "H62": {
        "charge": 0.4115,
        "parent": "N6",
      },
      "N1": {
        "charge": -0.7615,
      },
      "C2": {
        "charge": 0.5875,
      },
      "H2": {
        "charge": 0.0473,
        "parent": "C2",
      },
      "N3": {
        "charge": -0.6997,
      },
      "C4": {
        "charge": 0.3053,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H6": "H61",
      "2H6": "H62",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O2*": "O2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RC": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0066,
      },
      "H1'": {
        "charge": 0.2029,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0484,
      },
      "C6": {
        "charge": 0.0053,
      },
      "H6": {
        "charge": 0.1958,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5215,
      },
      "H5": {
        "charge": 0.1928,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8185,
      },
      "N4": {
        "charge": -0.953,
      },
      "H41": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7584,
      },
      "C2": {
        "charge": 0.7538,
      },
      "O2": {
        "charge": -0.6252,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RC3": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0066,
      },
      "H1'": {
        "charge": 0.2029,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0484,
      },
      "C6": {
        "charge": 0.0053,
      },
      "H6": {
        "charge": 0.1958,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5215,
      },
      "H5": {
        "charge": 0.1928,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8185,
      },
      "N4": {
        "charge": -0.953,
      },
      "H41": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7584,
      },
      "C2": {
        "charge": 0.7538,
      },
      "O2": {
        "charge": -0.6252,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RC5": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0066,
      },
      "H1'": {
        "charge": 0.2029,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0484,
      },
      "C6": {
        "charge": 0.0053,
      },
      "H6": {
        "charge": 0.1958,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5215,
      },
      "H5": {
        "charge": 0.1928,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8185,
      },
      "N4": {
        "charge": -0.953,
      },
      "H41": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7584,
      },
      "C2": {
        "charge": 0.7538,
      },
      "O2": {
        "charge": -0.6252,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RCN": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
      },
      "H5'2": {
        "charge": 0.0679,
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0066,
      },
      "H1'": {
        "charge": 0.2029,
        "parent": "C1'",
      },
      "N1": {
        "charge": -0.0484,
      },
      "C6": {
        "charge": 0.0053,
      },
      "H6": {
        "charge": 0.1958,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.5215,
      },
      "H5": {
        "charge": 0.1928,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.8185,
      },
      "N4": {
        "charge": -0.953,
      },
      "H41": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "H42": {
        "charge": 0.4234,
        "parent": "N4",
      },
      "N3": {
        "charge": -0.7584,
      },
      "C2": {
        "charge": 0.7538,
      },
      "O2": {
        "charge": -0.6252,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H4": "H41",
      "2H4": "H42",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O2*": "O2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RG": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0191,
      },
      "H1'": {
        "charge": 0.2006,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0492,
      },
      "C8": {
        "charge": 0.1374,
      },
      "H8": {
        "charge": 0.164,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5709,
      },
      "C5": {
        "charge": 0.1744,
      },
      "C6": {
        "charge": 0.477,
      },
      "O6": {
        "charge": -0.5597,
      },
      "N1": {
        "charge": -0.4787,
      },
      "H1": {
        "charge": 0.3424,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7657,
      },
      "N2": {
        "charge": -0.9672,
      },
      "H21": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6323,
      },
      "C4": {
        "charge": 0.1222,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RG3": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0191,
      },
      "H1'": {
        "charge": 0.2006,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0492,
      },
      "C8": {
        "charge": 0.1374,
      },
      "H8": {
        "charge": 0.164,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5709,
      },
      "C5": {
        "charge": 0.1744,
      },
      "C6": {
        "charge": 0.477,
      },
      "O6": {
        "charge": -0.5597,
      },
      "N1": {
        "charge": -0.4787,
      },
      "H1": {
        "charge": 0.3424,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7657,
      },
      "N2": {
        "charge": -0.9672,
      },
      "H21": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6323,
      },
      "C4": {
        "charge": 0.1222,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RG5": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0191,
      },
      "H1'": {
        "charge": 0.2006,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0492,
      },
      "C8": {
        "charge": 0.1374,
      },
      "H8": {
        "charge": 0.164,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5709,
      },
      "C5": {
        "charge": 0.1744,
      },
      "C6": {
        "charge": 0.477,
      },
      "O6": {
        "charge": -0.5597,
      },
      "N1": {
        "charge": -0.4787,
      },
      "H1": {
        "charge": 0.3424,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7657,
      },
      "N2": {
        "charge": -0.9672,
      },
      "H21": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6323,
      },
      "C4": {
        "charge": 0.1222,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "HO*2": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RGN": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
      },
      "H5'2": {
        "charge": 0.0679,
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0191,
      },
      "H1'": {
        "charge": 0.2006,
        "parent": "C1'",
      },
      "N9": {
        "charge": 0.0492,
      },
      "C8": {
        "charge": 0.1374,
      },
      "H8": {
        "charge": 0.164,
        "parent": "C8",
      },
      "N7": {
        "charge": -0.5709,
      },
      "C5": {
        "charge": 0.1744,
      },
      "C6": {
        "charge": 0.477,
      },
      "O6": {
        "charge": -0.5597,
      },
      "N1": {
        "charge": -0.4787,
      },
      "H1": {
        "charge": 0.3424,
        "parent": "N1",
      },
      "C2": {
        "charge": 0.7657,
      },
      "N2": {
        "charge": -0.9672,
      },
      "H21": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "H22": {
        "charge": 0.4364,
        "parent": "N2",
      },
      "N3": {
        "charge": -0.6323,
      },
      "C4": {
        "charge": 0.1222,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "1H2": "H21",
      "2H2": "H22",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O2*": "O2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RU": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0674,
      },
      "H1'": {
        "charge": 0.1824,
        "parent": "C1'",
      },
      "N1": {
        "charge": 0.0418,
      },
      "C6": {
        "charge": -0.1126,
      },
      "H6": {
        "charge": 0.2188,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.3635,
      },
      "H5": {
        "charge": 0.1811,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.5952,
      },
      "O4": {
        "charge": -0.5761,
      },
      "N3": {
        "charge": -0.3549,
      },
      "H3": {
        "charge": 0.3154,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.4687,
      },
      "O2": {
        "charge": -0.5477,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RU3": {
    "atoms": {
      "P": {
        "charge": 1.1662,
      },
      "O1P": {
        "charge": -0.776,
      },
      "O2P": {
        "charge": -0.776,
      },
      "O5'": {
        "charge": -0.4989,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0674,
      },
      "H1'": {
        "charge": 0.1824,
        "parent": "C1'",
      },
      "N1": {
        "charge": 0.0418,
      },
      "C6": {
        "charge": -0.1126,
      },
      "H6": {
        "charge": 0.2188,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.3635,
      },
      "H5": {
        "charge": 0.1811,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.5952,
      },
      "O4": {
        "charge": -0.5761,
      },
      "N3": {
        "charge": -0.3549,
      },
      "H3": {
        "charge": 0.3154,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.4687,
      },
      "O2": {
        "charge": -0.5477,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RU5": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "H5'2": {
        "charge": 0.0679,
        "parent": "C5'",
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0674,
      },
      "H1'": {
        "charge": 0.1824,
        "parent": "C1'",
      },
      "N1": {
        "charge": 0.0418,
      },
      "C6": {
        "charge": -0.1126,
      },
      "H6": {
        "charge": 0.2188,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.3635,
      },
      "H5": {
        "charge": 0.1811,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.5952,
      },
      "O4": {
        "charge": -0.5761,
      },
      "N3": {
        "charge": -0.3549,
      },
      "H3": {
        "charge": 0.3154,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.4687,
      },
      "O2": {
        "charge": -0.5477,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
        "parent": "C2'",
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
        "parent": "O2'",
      },
      "O3'": {
        "charge": -0.5246,
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "H5'": "H5'1",
      "H5*": "H5'1",
      "H5*1": "H5'1",
      "1H5'": "H5'1",
      "1H5*": "H5'1",
      "H5''": "H5'2",
      "H5**": "H5'2",
      "H5*2": "H5'2",
      "2H5'": "H5'2",
      "2H5*": "H5'2",
      'H5"': "H5'2",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "H2'": "H2'1",
      "H2*": "H2'1",
      "H2*1": "H2'1",
      "1H2'": "H2'1",
      "1H2*": "H2'1",
      "O2*": "O2'",
      "H2''": "HO'2",
      "H2**": "HO'2",
      "HO*2": "HO'2",
      "H2'2": "HO'2",
      "H2*2": "HO'2",
      "2HO'": "HO'2",
      "2HO*": "HO'2",
      "2H2'": "HO'2",
      "2H2*": "HO'2",
      "HO2'": "HO'2",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "RUN": {
    "atoms": {
      "H5T": {
        "charge": 0.4295,
        "parent": "O5'",
      },
      "O5'": {
        "charge": -0.6223,
      },
      "C5'": {
        "charge": 0.0558,
      },
      "H5'1": {
        "charge": 0.0679,
      },
      "H5'2": {
        "charge": 0.0679,
      },
      "C4'": {
        "charge": 0.1065,
      },
      "H4'": {
        "charge": 0.1174,
        "parent": "C4'",
      },
      "O4'": {
        "charge": -0.3548,
      },
      "C1'": {
        "charge": 0.0674,
      },
      "H1'": {
        "charge": 0.1824,
        "parent": "C1'",
      },
      "N1": {
        "charge": 0.0418,
      },
      "C6": {
        "charge": -0.1126,
      },
      "H6": {
        "charge": 0.2188,
        "parent": "C6",
      },
      "C5": {
        "charge": -0.3635,
      },
      "H5": {
        "charge": 0.1811,
        "parent": "C5",
      },
      "C4": {
        "charge": 0.5952,
      },
      "O4": {
        "charge": -0.5761,
      },
      "N3": {
        "charge": -0.3549,
      },
      "H3": {
        "charge": 0.3154,
        "parent": "N3",
      },
      "C2": {
        "charge": 0.4687,
      },
      "O2": {
        "charge": -0.5477,
      },
      "C3'": {
        "charge": 0.2022,
      },
      "H3'": {
        "charge": 0.0615,
        "parent": "C3'",
      },
      "C2'": {
        "charge": 0.067,
      },
      "H2'1": {
        "charge": 0.0972,
      },
      "O2'": {
        "charge": -0.6139,
      },
      "HO'2": {
        "charge": 0.4186,
      },
      "O3'": {
        "charge": -0.6541,
      },
      "H3T": {
        "charge": 0.4376,
        "parent": "O3'",
      },
    },
    "aliases": {
      "O5*": "O5'",
      "C5*": "C5'",
      "C4*": "C4'",
      "H4*": "H4'",
      "O4*": "O4'",
      "C1*": "C1'",
      "H1*": "H1'",
      "C3*": "C3'",
      "H3*": "H3'",
      "C2*": "C2'",
      "O2*": "O2'",
      "O3*": "O3'",
      "OP1": "O1P",
      "OP2": "O2P",
      "HO5'": "H5T",
      "HO3'": "H3T",
    },
  },
  "WAT": {
    "atoms": {
      "OW": {
        "charge": -0.834,
      },
      "H1": {
        "charge": 0.417,
        "parent": "OW",
      },
      "H2": {
        "charge": 0.417,
        "parent": "OW",
      },
    },
    "aliases": {
      "O": "OW",
      "OH2": "OW",
      "OH": "OW",
      "H1": "HW",
      "HH1": "HW",
      "1H": "HW",
      "H2": "HW",
      "HH2": "HW",
      "2H": "HW",
    },
  },
};
