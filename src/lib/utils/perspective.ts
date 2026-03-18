export interface Point {
    x: number;
    y: number;
}

export function getPerspectiveTransform(w: number, h: number, p0: Point, p1: Point, p2: Point, p3: Point): string {
    const x0 = p0.x, y0 = p0.y;
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;

    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

    let h31 = 0, h32 = 0;
    
    const det = dx1 * dy2 - dx2 * dy1;
    if (det !== 0) {
        h31 = (dx3 * dy2 - dx2 * dy3) / det;
        h32 = (dx1 * dy3 - dx3 * dy1) / det;
    }

    let h11 = x1 - x0 + h31 * x1;
    let h21 = y1 - y0 + h31 * y1;
    let h12 = x3 - x0 + h32 * x3;
    let h22 = y3 - y0 + h32 * y3;
    let h13 = x0;
    let h23 = y0;

    h11 /= w;
    h21 /= w;
    h31 /= w;
    h12 /= h;
    h22 /= h;
    h32 /= h;

    const f = (n: number) => n.toFixed(6);

    return `matrix3d(${f(h11)}, ${f(h21)}, 0, ${f(h31)}, ${f(h12)}, ${f(h22)}, 0, ${f(h32)}, 0, 0, 1, 0, ${f(h13)}, ${f(h23)}, 0, 1)`;
}
