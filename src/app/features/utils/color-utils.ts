
import Gradient from "javascript-color-gradient";

export function generateColorArray(midpoints: number) {
    const colors = new Gradient()
        // red, yellow, green
        .setColorGradient('#ff0000', '#ffff00', '#00ff00')
        .setMidpoint(midpoints)
        .getColors();

    // console.log('cUtil gCFP gradient colors: ', colors);
    return colors;
}
