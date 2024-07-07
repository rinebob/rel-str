import { RelStrStockList } from "./interfaces-rs";

export const BASELINE_EQUITY_SYMBOLS = ['SPY', 'QQQ'];

export const MOCK_STOCK_LISTS: RelStrStockList[] = [
    {name: 'list one with a long list name', baseline: 'QQQ', symbols: ['AAPL', 'NVDA', 'TSLA']},
    {name: 'list two', baseline: 'QQQ', symbols: ['MSFT', 'AMAT']},
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