import { StockDatum, StockData, BaselineTargetRankDatum } from "../common/interfaces-rs";

export const TSLA: StockDatum[] = [
    // {"07/05/23": 282.48},
    // {"07/06/23": 276.54},
    // {"07/07/23": 274.43},
    // {"07/10/23": 269.61},
    // {"07/11/23": 269.79},
    // {"07/12/23": 271.99},
    // {"07/13/23": 277.9},
    // {"07/14/23": 281.38},
    // {"07/17/23": 290.38},
    // {"07/18/23": 293.34},
    // {"07/19/23": 291.26},
    // {"07/20/23": 262.9},
    // {"07/21/23": 260.02},
    // {"07/24/23": 269.06},
    // {"07/25/23": 265.28},
    // {"07/26/23": 264.35},
    // {"07/27/23": 255.71},
    // {"07/28/23": 266.44},
    // {"07/31/23": 267.43},
    // {"08/01/23": 261.07},
    // {"08/02/23": 254.11},
    // {"08/03/23": 259.32},
    // {"08/04/23": 253.86},
    // {"08/07/23": 251.45},
    // {"08/08/23": 249.7},
    // {"08/09/23": 242.19},
    // {"08/10/23": 245.34},
    // {"08/11/23": 242.65},
    // {"08/14/23": 239.76},
    // {"08/15/23": 232.96},
    // {"08/16/23": 225.6},
    // {"08/17/23": 219.22},
    // {"08/18/23": 215.49},
    // {"08/21/23": 231.28},
    // {"08/22/23": 233.19},
    // {"08/23/23": 236.86},
    // {"08/24/23": 230.04},
    // {"08/25/23": 238.59},
    // {"08/28/23": 238.82},
    // {"08/29/23": 257.18},
    // {"08/30/23": 256.9},
    // {"08/31/23": 258.08},
    // {"09/01/23": 245.01},
    // {"09/05/23": 256.49},
    // {"09/06/23": 251.92},
    // {"09/07/23": 251.49},
    // {"09/08/23": 248.5},
    // {"09/11/23": 273.58},
    // {"09/12/23": 267.48},
    // {"09/13/23": 271.3},
    // {"09/14/23": 276.04},
    // {"09/15/23": 274.39},
    // {"09/18/23": 265.28},
    // {"09/19/23": 266.5},
    // {"09/20/23": 262.59},
    // {"09/21/23": 255.7},
    // {"09/22/23": 244.88},
    // {"09/25/23": 246.99},
    // {"09/26/23": 244.12},
    // {"09/27/23": 240.5},
    // {"09/28/23": 246.38},
    // {"09/29/23": 250.22},
    // {"10/02/23": 251.6},
    // {"10/03/23": 246.53},
    // {"10/04/23": 261.16},
    // {"10/05/23": 260.05},
    // {"10/06/23": 260.53},
    // {"10/09/23": 259.67},
    // {"10/10/23": 263.62},
    // {"10/11/23": 262.99},
    // {"10/12/23": 258.87},
    // {"10/13/23": 251.12},
    // {"10/16/23": 253.92},
    // {"10/17/23": 254.85},
    // {"10/18/23": 242.68},
    // {"10/19/23": 220.11},
    // {"10/20/23": 211.99},
    // {"10/23/23": 212.08},
    // {"10/24/23": 216.52},
    // {"10/25/23": 212.42},
    // {"10/26/23": 205.76},
    // {"10/27/23": 207.3},
    // {"10/30/23": 197.36},
    // {"10/31/23": 200.84},
    // {"11/01/23": 205.66},
    // {"11/02/23": 218.51},
    // {"11/03/23": 219.96},
    // {"11/06/23": 219.27},
    // {"11/07/23": 222.18},
    // {"11/08/23": 222.11},
    // {"11/09/23": 209.98},
    // {"11/10/23": 214.65},
    // {"11/13/23": 223.71},
    // {"11/14/23": 237.41},
    // {"11/15/23": 242.84},
    // {"11/16/23": 233.59},
    // {"11/17/23": 234.3},
    // {"11/20/23": 235.6},
    // {"11/21/23": 241.2},
    // {"11/22/23": 234.21},
    // {"11/24/23": 235.45},
    // {"11/27/23": 236.08},
    // {"11/28/23": 246.72},
    // {"11/29/23": 244.14},
    // {"11/30/23": 240.08},
    // {"12/01/23": 238.83},
    // {"12/04/23": 235.58},
    // {"12/05/23": 238.72},
    // {"12/06/23": 239.37},
    // {"12/07/23": 242.64},
    // {"12/08/23": 243.84},
    // {"12/11/23": 239.74},
    // {"12/12/23": 237.01},
    // {"12/13/23": 239.29},
    // {"12/14/23": 251.05},
    // {"12/15/23": 253.5},
    // {"12/18/23": 252.08},
    // {"12/19/23": 257.22},
    // {"12/20/23": 247.14},
    // {"12/21/23": 254.5},
    // {"12/22/23": 252.54},
    // {"12/26/23": 256.61},
    // {"12/27/23": 261.44},
    // {"12/28/23": 253.18},
    // {"12/29/23": 248.48},
    // {"01/02/24": 248.42},
    // {"01/03/24": 238.45},
    // {"01/04/24": 237.93},
    // {"01/05/24": 237.49},
    // {"01/08/24": 240.45},
    // {"01/09/24": 234.96},
    // {"01/10/24": 233.94},
    // {"01/11/24": 227.22},
    // {"01/12/24": 218.89},
    // {"01/16/24": 219.91},
    // {"01/17/24": 215.55},
    // {"01/18/24": 211.88},
    // {"01/19/24": 212.19},
    // {"01/22/24": 208.8},
    // {"01/23/24": 209.14},
    // {"01/24/24": 207.83},
    // {"01/25/24": 182.63},
    // {"01/26/24": 183.25},
    // {"01/29/24": 190.93},
    // {"01/30/24": 191.59},
    // {"01/31/24": 187.29},
    // {"02/01/24": 188.86},
    // {"02/02/24": 187.91},
    // {"02/05/24": 181.06},
    // {"02/06/24": 185.1},
    // {"02/07/24": 187.58},
    // {"02/08/24": 189.56},
    // {"02/09/24": 193.57},
    // {"02/12/24": 188.13},
    // {"02/13/24": 184.02},
    // {"02/14/24": 188.71},
    // {"02/15/24": 200.45},
    // {"02/16/24": 199.95},
    // {"02/20/24": 193.76},
    // {"02/21/24": 194.77},
    // {"02/22/24": 197.41},
    // {"02/23/24": 191.97},
    // {"02/26/24": 199.4},
    // {"02/27/24": 199.73},
    // {"02/28/24": 202.04},
    // {"02/29/24": 201.88},
    // {"03/01/24": 202.64},
    // {"03/04/24": 188.14},
    // {"03/05/24": 180.74},
    // {"03/06/24": 176.54},
    // {"03/07/24": 178.65},
    // {"03/08/24": 175.34},
    // {"03/11/24": 177.77},
    // {"03/12/24": 177.54},
    // {"03/13/24": 169.48},
    // {"03/14/24": 162.5},
    // {"03/15/24": 163.57},
    // {"03/18/24": 173.8},
    // {"03/19/24": 171.32},
    // {"03/20/24": 175.66},
    // {"03/21/24": 172.82},
    // {"03/22/24": 170.83},
    // {"03/25/24": 172.63},
    // {"03/26/24": 177.67},
    // {"03/27/24": 179.83},
    // {"03/28/24": 175.79},
    {"04/01/24": 175.22},
    {"04/02/24": 166.63},
    {"04/03/24": 168.38},
    {"04/04/24": 171.11},
    {"04/05/24": 164.9},
    {"04/08/24": 172.98},
    {"04/09/24": 176.88},
    {"04/10/24": 171.76},
    {"04/11/24": 174.6},
    {"04/12/24": 171.05},
    {"04/15/24": 161.48},
    {"04/16/24": 157.11},
    {"04/17/24": 155.45},
    {"04/18/24": 149.93},
    {"04/19/24": 147.05},
    {"04/22/24": 142.05},
    {"04/23/24": 144.68},
    {"04/24/24": 162.13},
    {"04/25/24": 170.18},
    {"04/26/24": 168.29},
    {"04/29/24": 194.05},
    {"04/30/24": 183.28},
    {"05/01/24": 179.99},
    {"05/02/24": 180.01},
    {"05/03/24": 181.19},
    {"05/06/24": 184.76},
    {"05/07/24": 177.81},
    {"05/08/24": 174.72},
    {"05/09/24": 171.97},
    {"05/10/24": 168.47},
    {"05/13/24": 171.89},
    {"05/14/24": 177.55},
    {"05/15/24": 173.99},
    {"05/16/24": 174.84},
    {"05/17/24": 177.46},
    {"05/20/24": 174.95},
    {"05/21/24": 186.6},
    {"05/22/24": 180.11},
    {"05/23/24": 173.74},
    {"05/24/24": 179.24},
    {"05/28/24": 176.75},
    {"05/29/24": 176.19},
    {"05/30/24": 178.79},
    {"05/31/24": 178.08},
    {"06/03/24": 176.29},
    {"06/04/24": 174.77},
    {"06/05/24": 175},
    {"06/06/24": 177.94},
    {"06/07/24": 177.48},
    {"06/10/24": 173.79},
    {"06/11/24": 170.66},
    {"06/12/24": 177.29},
    {"06/13/24": 182.47},
    {"06/14/24": 178.01},
    {"06/17/24": 187.44},
    {"06/18/24": 184.86},
    {"06/20/24": 181.57},
    {"06/21/24": 183.01},
    {"06/24/24": 182.58},
    {"06/25/24": 187.35},
    {"06/26/24": 196.37},
    {"06/27/24": 197.42},
    {"06/28/24": 197.88},
    {"07/01/24": 209.86},
    {"07/02/24": 231.26},
];

export const TSLA_DATA: StockData = {
    symbol: 'TSLA',
    data: [...TSLA],
    results: [],
    resultsByDate: {},
    ranksByDate: {},
}

export const QQQ_TSLA_TARGET_RANKS_WITH_COLORS: BaselineTargetRankDatum[] = [
    {
        date: "04/09/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "04/10/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "04/11/24",
        value: 0.53125,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "04/12/24",
        value: 0.6875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "04/15/24",
        value: 0.1875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "04/16/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/17/24",
        value: 0.125,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/18/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/19/24",
        value: 0.125,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/22/24",
        value: 0.125,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "04/23/24",
        value: 0.25,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "04/24/24",
        value: 0.625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "04/25/24",
        value: 0.875,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "04/26/24",
        value: 0.75,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "04/29/24",
        value: 0.9375,
        index: 9,
        color: "#33ff00"
    },
    {
        date: "04/30/24",
        value: 0.84375,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/01/24",
        value: 0.6875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/02/24",
        value: 0.53125,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/03/24",
        value: 0.53125,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/06/24",
        value: 0.15625,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "05/07/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "05/08/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "05/09/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "05/10/24",
        value: 0.0625,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "05/13/24",
        value: 0.1875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "05/14/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/15/24",
        value: 0.3125,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/16/24",
        value: 0.5,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/17/24",
        value: 0.78125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "05/20/24",
        value: 0.34375,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "05/21/24",
        value: 0.65625,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/22/24",
        value: 0.5,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "05/23/24",
        value: 0.375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "05/24/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "05/28/24",
        value: 0.40625,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "05/29/24",
        value: 0.1875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "05/30/24",
        value: 0.6875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "05/31/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/03/24",
        value: 0.34375,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "06/04/24",
        value: 0.46875,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "06/05/24",
        value: 0.21875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "06/06/24",
        value: 0.4375,
        index: 4,
        color: "#ffcc00"
    },
    {
        date: "06/07/24",
        value: 0.1875,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "06/10/24",
        value: 0.15625,
        index: 2,
        color: "#ff6600"
    },
    {
        date: "06/11/24",
        value: 0.09375,
        index: 1,
        color: "#ff3300"
    },
    {
        date: "06/12/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "06/13/24",
        value: 0.59375,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "06/14/24",
        value: 0.25,
        index: 3,
        color: "#ff9900"
    },
    {
        date: "06/17/24",
        value: 0.71875,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "06/18/24",
        value: 0.65625,
        index: 7,
        color: "#99ff00"
    },
    {
        date: "06/20/24",
        value: 0.53125,
        index: 5,
        color: "#ffff00"
    },
    {
        date: "06/21/24",
        value: 0.5625,
        index: 6,
        color: "#ccff00"
    },
    {
        date: "06/24/24",
        value: 0.8125,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/25/24",
        value: 0.75,
        index: 8,
        color: "#66ff00"
    },
    {
        date: "06/26/24",
        value: 0.96875,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "06/27/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "06/28/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "07/01/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    },
    {
        date: "07/02/24",
        value: 1,
        index: 10,
        color: "#00ff00"
    }
]