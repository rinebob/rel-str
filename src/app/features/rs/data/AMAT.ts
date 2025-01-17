import { StockDatum, StockData, BaselineTargetRankDatum } from "../common/interfaces-rs";

export const AMAT: StockDatum[] = [
    // {"07/05/23": 142.26},
    // {"07/06/23": 140.38},
    // {"07/07/23": 139.57},
    // {"07/10/23": 140.56},
    // {"07/11/23": 137.56},
    // {"07/12/23": 138.89},
    // {"07/13/23": 142.65},
    // {"07/14/23": 142.74},
    // {"07/17/23": 145.5},
    // {"07/18/23": 144.51},
    // {"07/19/23": 141.78},
    // {"07/20/23": 134.04},
    // {"07/21/23": 136.4},
    // {"07/24/23": 138.35},
    // {"07/25/23": 140.06},
    // {"07/26/23": 139.02},
    // {"07/27/23": 146.14},
    // {"07/28/23": 151.93},
    // {"07/31/23": 151.59},
    // {"08/01/23": 152.63},
    // {"08/02/23": 147.33},
    // {"08/03/23": 147.81},
    // {"08/04/23": 145.66},
    // {"08/07/23": 150.38},
    // {"08/08/23": 148.01},
    // {"08/09/23": 145.16},
    // {"08/10/23": 144.61},
    // {"08/11/23": 138.83},
    // {"08/14/23": 141.89},
    // {"08/15/23": 140.08},
    // {"08/16/23": 138.25},
    // {"08/17/23": 137.59},
    // {"08/18/23": 142.66},
    // {"08/21/23": 148.77},
    // {"08/22/23": 147.85},
    // {"08/23/23": 148},
    // {"08/24/23": 142.52},
    // {"08/25/23": 144.36},
    // {"08/28/23": 145.42},
    // {"08/29/23": 149.98},
    // {"08/30/23": 150.95},
    // {"08/31/23": 152.76},
    // {"09/01/23": 153.99},
    // {"09/05/23": 153.61},
    // {"09/06/23": 153.18},
    // {"09/07/23": 148.23},
    // {"09/08/23": 147.53},
    // {"09/11/23": 146.71},
    // {"09/12/23": 143.97},
    // {"09/13/23": 144.58},
    // {"09/14/23": 144.57},
    // {"09/15/23": 138.25},
    // {"09/18/23": 140.27},
    // {"09/19/23": 137.71},
    // {"09/20/23": 136.97},
    // {"09/21/23": 135.19},
    // {"09/22/23": 136.17},
    // {"09/25/23": 136.59},
    // {"09/26/23": 134.08},
    // {"09/27/23": 135.06},
    // {"09/28/23": 138.22},
    // {"09/29/23": 138.45},
    // {"10/02/23": 139.51},
    // {"10/03/23": 136.72},
    // {"10/04/23": 139.3},
    // {"10/05/23": 139.28},
    // {"10/06/23": 140.29},
    // {"10/09/23": 140.15},
    // {"10/10/23": 141.4},
    // {"10/11/23": 142.18},
    // {"10/12/23": 145},
    // {"10/13/23": 141.14},
    // {"10/16/23": 141},
    // {"10/17/23": 142.72},
    // {"10/18/23": 141.45},
    // {"10/19/23": 134.43},
    // {"10/20/23": 134.12},
    // {"10/23/23": 134.23},
    // {"10/24/23": 134.9},
    // {"10/25/23": 130.11},
    // {"10/26/23": 130.84},
    // {"10/27/23": 131.3},
    // {"10/30/23": 131.03},
    // {"10/31/23": 132.35},
    // {"11/01/23": 135.29},
    // {"11/02/23": 138.51},
    // {"11/03/23": 139.75},
    // {"11/06/23": 140.36},
    // {"11/07/23": 141.74},
    // {"11/08/23": 144.23},
    // {"11/09/23": 143.17},
    // {"11/10/23": 150.68},
    // {"11/13/23": 149.74},
    // {"11/14/23": 154.08},
    // {"11/15/23": 155.37},
    // {"11/16/23": 154.81},
    // {"11/17/23": 148.59},
    // {"11/20/23": 152.57},
    // {"11/21/23": 149.25},
    // {"11/22/23": 149.48},
    // {"11/24/23": 150.34},
    // {"11/27/23": 150.81},
    // {"11/28/23": 148.06},
    // {"11/29/23": 149.36},
    // {"11/30/23": 149.78},
    // {"12/01/23": 151.59},
    // {"12/04/23": 148.27},
    // {"12/05/23": 146.15},
    // {"12/06/23": 144.7},
    // {"12/07/23": 148.39},
    // {"12/08/23": 147.72},
    // {"12/11/23": 155.14},
    // {"12/12/23": 157.22},
    // {"12/13/23": 156.99},
    // {"12/14/23": 161.74},
    // {"12/15/23": 161.95},
    // {"12/18/23": 160.36},
    // {"12/19/23": 162.33},
    // {"12/20/23": 156.92},
    // {"12/21/23": 161.39},
    // {"12/22/23": 162.05},
    // {"12/26/23": 164.28},
    // {"12/27/23": 164.21},
    // {"12/28/23": 163.12},
    // {"12/29/23": 162.07},
    // {"01/02/24": 154.37},
    // {"01/03/24": 151.45},
    // {"01/04/24": 149.31},
    // {"01/05/24": 149},
    // {"01/08/24": 151.56},
    // {"01/09/24": 151.03},
    // {"01/10/24": 149.81},
    // {"01/11/24": 151.95},
    // {"01/12/24": 151.25},
    // {"01/16/24": 153.76},
    // {"01/17/24": 153.37},
    // {"01/18/24": 160.34},
    // {"01/19/24": 167.94},
    // {"01/22/24": 168.3},
    // {"01/23/24": 167.05},
    // {"01/24/24": 174.14},
    // {"01/25/24": 172.63},
    // {"01/26/24": 166.9},
    // {"01/29/24": 168.48},
    // {"01/30/24": 166.24},
    // {"01/31/24": 164.3},
    // {"02/01/24": 166.97},
    // {"02/02/24": 168.18},
    // {"02/05/24": 171.09},
    // {"02/06/24": 168.7},
    // {"02/07/24": 170.9},
    // {"02/08/24": 173.89},
    // {"02/09/24": 185.84},
    // {"02/12/24": 185.54},
    // {"02/13/24": 180.31},
    // {"02/14/24": 186.19},
    // {"02/15/24": 187.66},
    // {"02/16/24": 199.57},
    // {"02/20/24": 189.14},
    // {"02/21/24": 190.33},
    // {"02/22/24": 199.73},
    // {"02/23/24": 197.16},
    // {"02/26/24": 203.55},
    // {"02/27/24": 202.86},
    // {"02/28/24": 197.54},
    // {"02/29/24": 201.62},
    // {"03/01/24": 210.25},
    // {"03/04/24": 209.49},
    // {"03/05/24": 207.39},
    // {"03/06/24": 212.17},
    // {"03/07/24": 212.61},
    // {"03/08/24": 205.56},
    // {"03/11/24": 201.37},
    // {"03/12/24": 204.94},
    // {"03/13/24": 200.56},
    // {"03/14/24": 200.75},
    // {"03/15/24": 198.65},
    // {"03/18/24": 200.73},
    // {"03/19/24": 201.34},
    // {"03/20/24": 205.06},
    // {"03/21/24": 210.8},
    // {"03/22/24": 210.25},
    // {"03/25/24": 208.46},
    // {"03/26/24": 206.67},
    // {"03/27/24": 208},
    // {"03/28/24": 206.23},
    {"04/01/24": 208.69},
    {"04/02/24": 206.11},
    {"04/03/24": 207.38},
    {"04/04/24": 203.39},
    {"04/05/24": 207.85},
    {"04/08/24": 209.04},
    {"04/09/24": 210.41},
    {"04/10/24": 209.25},
    {"04/11/24": 212.98},
    {"04/12/24": 207.86},
    {"04/15/24": 205.68},
    {"04/16/24": 209.48},
    {"04/17/24": 199.89},
    {"04/18/24": 194.32},
    {"04/19/24": 189.77},
    {"04/22/24": 189.46},
    {"04/23/24": 193.24},
    {"04/24/24": 196.06},
    {"04/25/24": 197.5},
    {"04/26/24": 203.38},
    {"04/29/24": 205.26},
    {"04/30/24": 198.65},
    {"05/01/24": 193.99},
    {"05/02/24": 197.91},
    {"05/03/24": 204.09},
    {"05/06/24": 208.86},
    {"05/07/24": 207.32},
    {"05/08/24": 207.36},
    {"05/09/24": 206.33},
    {"05/10/24": 209.73},
    {"05/13/24": 206.63},
    {"05/14/24": 209.82},
    {"05/15/24": 217.49},
    {"05/16/24": 214.03},
    {"05/17/24": 212.08},
    {"05/20/24": 219.95},
    {"05/21/24": 219.8},
    {"05/22/24": 218.15},
    {"05/23/24": 217.95},
    {"05/24/24": 220.89},
    {"05/28/24": 221.32},
    {"05/29/24": 219.05},
    {"05/30/24": 216.54},
    {"05/31/24": 215.08},
    {"06/03/24": 214.21},
    {"06/04/24": 212.22},
    {"06/05/24": 223.37},
    {"06/06/24": 221.75},
    {"06/07/24": 221.73},
    {"06/10/24": 228.16},
    {"06/11/24": 229.97},
    {"06/12/24": 237.65},
    {"06/13/24": 237.55},
    {"06/14/24": 237.03},
    {"06/17/24": 242.86},
    {"06/18/24": 247.83},
    {"06/20/24": 239.99},
    {"06/21/24": 235.41},
    {"06/24/24": 229.84},
    {"06/25/24": 234.27},
    {"06/26/24": 232.17},
    {"06/27/24": 232.53},
    {"06/28/24": 235.99},
    {"07/01/24": 237.41},
    {"07/02/24": 240.86},
];

export const AMAT_DATA: StockData = {
    symbol: 'AMAT',
    data: [...AMAT],
    results: [],
    resultsByDate: {},
    ranksByDate: {},
}

export const QQQ_AMAT_TARGET_RANKS_WITH_COLORS: BaselineTargetRankDatum[] = [
    {
        date: "04/09/24",
        value: 0.9375,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "04/10/24",
        value: 0.9375,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "04/11/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "04/12/24",
        value: 0.5,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "04/15/24",
        value: 0.75,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "04/16/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "04/17/24",
        value: 0.375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "04/18/24",
        value: 0.1875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "04/19/24",
        value: 0.25,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "04/22/24",
        value: 0.09375,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/23/24",
        value: 0.09375,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/24/24",
        value: 0.4375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "04/25/24",
        value: 0.78125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "04/26/24",
        value: 0.90625,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "04/29/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "04/30/24",
        value: 0.65625,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/01/24",
        value: 0.40625,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "05/02/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/03/24",
        value: 0.5625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/06/24",
        value: 0.65625,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/07/24",
        value: 0.5,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/08/24",
        value: 0.90625,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "05/09/24",
        value: 0.5625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/10/24",
        value: 0.75,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/13/24",
        value: 0.28125,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/14/24",
        value: 0.625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/15/24",
        value: 0.75,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/16/24",
        value: 0.5,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/17/24",
        value: 0.3125,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/20/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/21/24",
        value: 0.71875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/22/24",
        value: 0.4375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "05/23/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/24/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/28/24",
        value: 0.34375,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/29/24",
        value: 0.28125,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/30/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/31/24",
        value: 0.21875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "06/03/24",
        value: 0.03125,
        index: 0,
        color: "#ff0000"
    },
    {
        date: "06/04/24",
        value: 0.03125,
        index: 0,
        color: "#ff0000"
    },
    {
        date: "06/05/24",
        value: 0.53125,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "06/06/24",
        value: 0.46875,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "06/07/24",
        value: 0.5625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "06/10/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/11/24",
        value: 0.875,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "06/12/24",
        value: 0.875,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "06/13/24",
        value: 0.875,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "06/14/24",
        value: 0.78125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/17/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/18/24",
        value: 0.875,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "06/20/24",
        value: 0.375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "06/21/24",
        value: 0.28125,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "06/24/24",
        value: 0.25,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "06/25/24",
        value: 0.375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "06/26/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "06/27/24",
        value: 0.09375,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "06/28/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "07/01/24",
        value: 0.6875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "07/02/24",
        value: 0.6875,
        index: 7,
        color: "#99ff00"
    }
]