import { AxisModel, CrosshairSettingsModel, TooltipSettingsModel, ZoomSettingsModel } from "@syncfusion/ej2-charts";
import { RelStrStockList, RsSyncfusionChartConfig, RsChartConfig, Timeframe } from "../types/rs.interfaces";

export const STOCK_LIST_INITIALIZER: RelStrStockList = {name: '', baseline: '', symbols: [], ranksDataWithColors: {}};

export const BASELINE_EQUITY_SYMBOLS = ['SPY', 'QQQ'];

export const MOCK_STOCK_LISTS: RelStrStockList[] = [
    {name: 'list one with a long list name', baseline: 'QQQ', symbols: [
        {
            symbol: "AAPL",
            company: "Apple Inc."
        }, 
        {
            symbol: "NVDA",
            company: "Nvidia Corporation"
        }, 
        {
            symbol: "TSLA",
            company: "Tesla, Inc."
        },
    ]},
    {name: 'list two', baseline: 'QQQ', symbols: [
        {
            symbol: "MSFT",
            company: "Microsoft"
        },
        {
            symbol: "AMAT",
            company: "Applied Materials, Inc."
        },
        
    ]},
    {name: 'list three', baseline: 'QQQ', symbols: [
        {
            symbol: "MSFT",
            company: "Microsoft"
        },
        {
            symbol: "AMAT",
            company: "Applied Materials, Inc."
        },
        {
            symbol: "AAPL",
            company: "Apple Inc."
        }, 
        
    ]},
    {name: 'list four', baseline: 'QQQ', symbols: [
        {
            symbol: "MSFT",
            company: "Microsoft"
        },
        {
            symbol: "AMAT",
            company: "Applied Materials, Inc."
        },
        {
            symbol: "NVDA",
            company: "Nvidia Corporation"
        }, 
        
    ]},
    {name: 'list five', baseline: 'QQQ', symbols: [
        {
            symbol: "AAPL",
            company: "Apple Inc."
        },
        {
            symbol: "NVDA",
            company: "Nvidia Corporation"
        }, 
        {
            symbol: "TSLA",
            company: "Tesla, Inc."
        },
    ]},
    {name: 'list six', baseline: 'QQQ', symbols: [
        {
            symbol: "MSFT",
            company: "Microsoft"
        },
        {
            symbol: "AMAT",
            company: "Applied Materials, Inc."
        },
        {
            symbol: "AAPL",
            company: "Apple Inc."
        },
    ]},
    {name: 'list seven', baseline: 'QQQ', symbols: [
        {
            symbol: "MSFT",
            company: "Microsoft"
        },
        {
            symbol: "NVDA",
            company: "Nvidia Corporation"
        },
        {
            symbol: "AAPL",
            company: "Apple Inc."
        },
        {
            symbol: "AMAT",
            company: "Applied Materials, Inc."
        },
        {
            symbol: "TSLA",
            company: "Tesla, Inc."
        },
    ]},
];

export const CREATE_TEXT = 'create new list';
export const FORM_MODE_CREATE_TEXT = 'create new stock list';
export const FORM_MODE_EDIT_TEXT = 'edit stock list';

export const COMPARISON_MATRICES = [
['00000'],
['00001'],
['00010'],
['00011'],
['00100'],
['00101'],
['00110'],
['00111'],
['01000'],
['01001'],
['01010'],
['01011'],
['01100'],
['01101'],
['01110'],
['01111'],
['10000'],
['10001'],
['10010'],
['10011'],
['10100'],
['10101'],
['10110'],
['10111'],
['11000'],
['11001'],
['11010'],
['11011'],
['11100'],
['11101'],
['11110'],
['11111'],
];

//////////////////// CHART CONFIGS ////////////////////////////////
// Syncfusion chart config constants
// https://helpej2.syncfusion.com/angular/documentation/api/chart/

// Zoom configuration for charts
export const ZOOM_ENABLED_CONFIG: ZoomSettingsModel = {
    enableMouseWheelZooming: true,
    enablePinchZooming: true,
    enableSelectionZooming: true,
    enablePan: true,
    showToolbar: true,
    enableScrollbar: true,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
    mode: 'X',
    toolbarPosition: {
        horizontalAlignment: 'Near',
        verticalAlignment: 'Top',
        draggable: true
    }
};

export const ZOOM_DISABLED_CONFIG: ZoomSettingsModel = {
    enableMouseWheelZooming: false,
    enablePinchZooming: false,
    enableSelectionZooming: false,
    enablePan: false,
    showToolbar: false,
    enableScrollbar: false,
    toolbarItems: []
};

export const MAIN_RS_CHART_ZOOM_SETTINGS: ZoomSettingsModel = {
    enableScrollbar: true,
    enableSelectionZooming: true,
    // Keep wheel/pinch zoom disabled for stability; rely on toolbar + drag.
    enableMouseWheelZooming: false,
    enablePinchZooming: false,
    enablePan: true,
    // NOTE: enableAnimation disables chart Y axis autoresize on zoom!!! do not enable!!
    // enableAnimation: true,
    mode: 'X',
    // Disable the zoom toolbar to avoid Syncfusion Toolkit runtime errors.
    showToolbar: true,
    toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
    toolbarPosition: {
        draggable: true,
        horizontalAlignment: 'Near',
        verticalAlignment: 'Top',
    }
}

const CROSSHAIR_SETTINGS: CrosshairSettingsModel = {
    enable: true,
    snapToData: true,
}

const MAIN_RS_CHART_X_AXIS_CONFIG: AxisModel = {
    
    lineStyle: {},
    majorGridLines: {},
    valueType: 'DateTime',
    rangePadding: 'Round',
    crosshairTooltip: { enable: true },
    title: 'Date',
    intervalType: 'Months',
    labelFormat: 'MMM yyyy'
}

const MAIN_RS_CHART_Y_AXIS_CONFIG: AxisModel = {
    title: 'Price (USD)',
    opposedPosition: true,
}

const MAIN_RS_CHART_LEGEND_CONFIG: AxisModel = {
    visible: true,
}

const MAIN_RS_CHART_TOOLTIP_CONFIG: TooltipSettingsModel = {
    enable: true,
}

// Microsoft (MSFT) Chart Configuration
export const MSFT_CHART_CONFIG: RsChartConfig = {
    id: 'chart-msft',
    name: 'Microsoft (MSFT)',
    targetSymbol: 'MSFT',
    baselineSymbol: 'QQQ',
    timeframe: Timeframe.DAILY,
    chartConfig: {
        crosshair: CROSSHAIR_SETTINGS,
        legend: MAIN_RS_CHART_LEGEND_CONFIG,
        lineStyle: { width: 0 },
        primaryXAxis: MAIN_RS_CHART_X_AXIS_CONFIG,
        primaryYAxis: {
            ...MAIN_RS_CHART_Y_AXIS_CONFIG,
            title: 'Price (USD)'
        },
        tooltip: MAIN_RS_CHART_TOOLTIP_CONFIG,
        zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS
    },
    showRS: true,
    showBaseline: true,
    showVolume: true,
    showTechnicalIndicators: ['SMA', 'RSI'],
    height: '500px'
};

// NVIDIA (NVDA) Chart Configuration
export const NVDA_CHART_CONFIG: RsChartConfig = {
    id: 'chart-nvda',
    name: 'NVIDIA (NVDA)',
    targetSymbol: 'NVDA',
    baselineSymbol: 'QQQ',
    timeframe: Timeframe.WEEKLY,
    chartConfig: {
        crosshair: CROSSHAIR_SETTINGS,
        legend: {
            ...MAIN_RS_CHART_LEGEND_CONFIG,
            position: 'Bottom'
        },
        lineStyle: { width: 0 },
        primaryXAxis: MAIN_RS_CHART_X_AXIS_CONFIG,
        primaryYAxis: {
            ...MAIN_RS_CHART_Y_AXIS_CONFIG,
            title: 'Price (USD)',
            labelFormat: 'n0'
        },
        zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS,
        tooltip: MAIN_RS_CHART_TOOLTIP_CONFIG
    },
    showRS: true,
    showBaseline: true,
    showVolume: true,
    showTechnicalIndicators: ['EMA', 'MACD'],
    height: '500px'
};

// Alphabet (GOOG) Chart Configuration
export const GOOG_CHART_CONFIG: RsChartConfig = {
    id: 'chart-goog',
    name: 'Alphabet (GOOG)',
    targetSymbol: 'GOOG',
    baselineSymbol: 'SPY',
    timeframe: Timeframe.MONTHLY,
    chartConfig: {
        crosshair: CROSSHAIR_SETTINGS,
        legend: MAIN_RS_CHART_LEGEND_CONFIG,
        lineStyle: { width: 0 },
        primaryXAxis: {
            ...MAIN_RS_CHART_X_AXIS_CONFIG,
        },
        primaryYAxis: MAIN_RS_CHART_Y_AXIS_CONFIG,
        zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS,
        tooltip: MAIN_RS_CHART_TOOLTIP_CONFIG
    },
    showRS: true,
    showBaseline: true,
    showVolume: false,
    showTechnicalIndicators: ['BB', 'StochRSI'],
    height: '450px'
};

// Apple (AAPL) Chart Configuration
export const AAPL_CHART_CONFIG: RsChartConfig = {
    id: 'chart-aapl',
    name: 'Apple (AAPL)',
    targetSymbol: 'AAPL',
    baselineSymbol: 'SPY',
    timeframe: Timeframe.DAILY,
    chartConfig: {
        crosshair: {
            enable: true,
            lineType: 'Vertical',
            line: { width: 1, color: '#757575' }
        },
        legend: MAIN_RS_CHART_LEGEND_CONFIG,
        lineStyle: { width: 0 },
        primaryXAxis: MAIN_RS_CHART_X_AXIS_CONFIG,
        primaryYAxis: MAIN_RS_CHART_Y_AXIS_CONFIG,
        zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS,
        tooltip: MAIN_RS_CHART_TOOLTIP_CONFIG
    },
    showRS: true,
    showBaseline: false,
    showVolume: true,
    showTechnicalIndicators: ['SMA', 'Volume'],
    height: '500px'
};

// Array of all chart configurations
export const CHART_CONFIGS: RsChartConfig[] = [
    MSFT_CHART_CONFIG,
    NVDA_CHART_CONFIG,
    GOOG_CHART_CONFIG,
    AAPL_CHART_CONFIG,
    // MSFT_CHART_CONFIG,
    // NVDA_CHART_CONFIG,
    // GOOG_CHART_CONFIG,
    // AAPL_CHART_CONFIG,
    // MSFT_CHART_CONFIG,
    // NVDA_CHART_CONFIG,
    // GOOG_CHART_CONFIG,
    // AAPL_CHART_CONFIG,
];

// This is for the main candlestick chart
export const RS_CHART_CONFIG: RsSyncfusionChartConfig = {
    crosshair: CROSSHAIR_SETTINGS,
    legend: MAIN_RS_CHART_LEGEND_CONFIG,
    lineStyle: {width: 0},
    primaryXAxis: MAIN_RS_CHART_X_AXIS_CONFIG,
    primaryYAxis: MAIN_RS_CHART_Y_AXIS_CONFIG,
    tooltip: MAIN_RS_CHART_TOOLTIP_CONFIG,
    zoomSettings: MAIN_RS_CHART_ZOOM_SETTINGS,
}

export const MAIN_CHART_INITIAL_DAYS = 252;
export const SMALL_CHART_INITIAL_DAYS = 60;

// RS thresholds (keep in sync with backend webhooks-config defaults)
export const RS_OPEN_LONG_THRESHOLD = 0.8;
export const RS_CLOSE_LONG_THRESHOLD = 0.8;
export const RS_OPEN_SHORT_THRESHOLD = 0.2;
export const RS_CLOSE_SHORT_THRESHOLD = 0.2;

//////////////////////////////////////////////////////////////////////////
