import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

const inputDir = 'tests/images';
const outputDir = 'tests/images/out';
const reportFile = 'tests/board_localization_report.md';

function findBoardQuad(src, contours, imageArea) {
    let maxArea = 0;
    let bestQuad = null;
    
    // First pass: try to find a natural 4-sided polygon contour
    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt, false);
        
        // Filter out extreme sizes
        if (area > imageArea * 0.05 && area < imageArea * 0.95) {
            let tmp = new cv.Mat();
            let perimeter = cv.arcLength(cnt, true);
            // Epsilon to accommodate lens distortion and slight curves
            cv.approxPolyDP(cnt, tmp, 0.02 * perimeter, true);
            
            if (tmp.rows === 4 && area > maxArea) {
                maxArea = area;
                if (bestQuad) bestQuad.delete();
                bestQuad = tmp.clone();
            }
            tmp.delete();
        }
    }
    
    // Fallback: if no natural 4-point quad is found, find the largest contour,
    // get its convex hull, and forcefully approximate it down to 4 points.
    if (!bestQuad) {
        let maxContour = null;
        maxArea = 0;
        
        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt, false);
            if (area > imageArea * 0.05 && area < imageArea * 0.95 && area > maxArea) {
                maxArea = area;
                maxContour = cnt;
            }
        }
        
        if (maxContour) {
            let hull = new cv.Mat();
            cv.convexHull(maxContour, hull, true, true);
            let epsilon = 0.01 * cv.arcLength(hull, true);
            let tmp = new cv.Mat();
            
            // Iteratively increase epsilon until we simplify to exactly 4 points
            for (let iter = 0; iter < 100; iter++) {
                cv.approxPolyDP(hull, tmp, epsilon, true);
                if (tmp.rows === 4) {
                    bestQuad = tmp.clone();
                    break;
                } else if (tmp.rows < 4) {
                    break; // went too far, stop
                }
                epsilon *= 1.1; // slowly increase epsilon
            }
            hull.delete();
            tmp.delete();
        }
    }
    
    if (bestQuad && bestQuad.rows === 4) {
        let pts = [];
        for (let i = 0; i < 4; i++) {
            pts.push({ x: bestQuad.data32S[i * 2], y: bestQuad.data32S[i * 2 + 1] });
        }
        bestQuad.delete();
        return pts;
    }
    
    if (bestQuad) bestQuad.delete();
    return null;
}

async function processImage(filename) {
    const inputPath = path.join(inputDir, filename);
    const outputPath = path.join(outputDir, filename);
    
    console.log(`Processing ${filename}...`);
    const image = await Jimp.read(inputPath);
    
    let src = new cv.Mat(image.bitmap.height, image.bitmap.width, cv.CV_8UC4);
    src.data.set(image.bitmap.data);
    
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    
    let blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    
    let edges = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150, 3, false);
    
    let dilated = new cv.Mat();
    let M = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, dilated, M, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    
    let imageArea = src.rows * src.cols;
    
    let quadPts = findBoardQuad(src, contours, imageArea);
    
    if (quadPts) {
        // Draw the quadrilateral
        for (let i = 0; i < 4; i++) {
            let pt1 = new cv.Point(quadPts[i].x, quadPts[i].y);
            let pt2 = new cv.Point(quadPts[(i + 1) % 4].x, quadPts[(i + 1) % 4].y);
            // Draw a thick green line connecting the points
            cv.line(src, pt1, pt2, new cv.Scalar(0, 255, 0, 255), 5);
        }
    } else {
        console.log(`Could not find a quadrilateral bounding box in ${filename}`);
    }
    
    // Copy data back to Jimp
    image.bitmap.data.set(src.data);
    await image.write(outputPath);
    
    src.delete(); gray.delete(); blurred.delete(); edges.delete(); dilated.delete(); M.delete();
    contours.delete(); hierarchy.delete();
}

cv.onRuntimeInitialized = async () => {
    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
        
        let reportMd = `# Chessboard Localization Test Report\n\n`;
        reportMd += `This report verifies the initial board localization step of the image processing pipeline.\n`;
        reportMd += `Using Algorithm: Quadrilateral Contour Extraction\n\n`;
        reportMd += `| Original Image | Detected Board Quadrilateral |\n`;
        reportMd += `|----------------|------------------------------|\n`;
        
        for (const file of files) {
            await processImage(file);
            reportMd += `| ![Original](images/${file}) | ![Annotated](images/out/${file}) |\n`;
        }
        
        fs.writeFileSync(reportFile, reportMd);
        console.log(`\nReport generated at ${reportFile}`);
    } catch (err) {
        console.error("Error during processing:", err);
    }
};
