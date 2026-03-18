import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

const inputDir = 'tests/images';
const outputDir = 'tests/images/out';
const reportFile = 'tests/board_localization_report.md';

const USE_CENTER_OUT_HEURISTIC = process.env.USE_OLD_BBOX_ALGO !== 'true'; // Toggle between approaches

function findBoundingBoxOld(src, contours, imageArea) {
    let maxArea = 0;
    let maxContour = null;
    
    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt, false);
        
        // Filter out extreme sizes (too small or the entire image border)
        if (area > imageArea * 0.05 && area < imageArea * 0.95) {
            let tmp = new cv.Mat();
            let perimeter = cv.arcLength(cnt, true);
            // Higher epsilon to accommodate lens distortion on chessboards
            cv.approxPolyDP(cnt, tmp, 0.05 * perimeter, true);
            
            // Prefer 4 points, but fallback to the largest contour otherwise
            if (tmp.rows === 4 && area > maxArea) {
                maxArea = area;
                if (maxContour) maxContour.delete();
                maxContour = tmp.clone();
            } else if (maxContour === null && area > maxArea) {
                maxArea = area;
                if (maxContour) maxContour.delete();
                maxContour = cnt.clone();
            }
            tmp.delete();
        }
    }
    
    if (maxContour) {
        let rect = cv.boundingRect(maxContour);
        maxContour.delete();
        return rect;
    }
    return null;
}

function findBoundingBoxNew(src, contours, imageArea) {
    let squares = [];
    
    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt, false);
        
        // A single square on an 8x8 board is ~1/64 of the board area.
        // Assuming the board occupies between 10% and 90% of the image,
        // a square could be roughly between 0.15% and 5% of the image.
        // We will be slightly more forgiving.
        if (area > imageArea * 0.0005 && area < imageArea * 0.05) {
            let rect = cv.boundingRect(cnt);
            let aspect = rect.width / rect.height;
            // Loosely square
            if (aspect > 0.4 && aspect < 2.5) {
                squares.push({
                    rect: rect,
                    center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
                    area: area
                });
            }
        }
    }
    
    if (squares.length === 0) return null;
    
    // Sort by distance to the center of the image
    let cx = src.cols / 2;
    let cy = src.rows / 2;
    squares.sort((a, b) => {
        let da = Math.pow(a.center.x - cx, 2) + Math.pow(a.center.y - cy, 2);
        let db = Math.pow(b.center.x - cx, 2) + Math.pow(b.center.y - cy, 2);
        return da - db;
    });
    
    let centerSquare = squares[0];
    let expectedWidth = centerSquare.rect.width;
    let expectedHeight = centerSquare.rect.height;
    
    let gridSquares = [];
    
    for (let sq of squares) {
        // Must be of somewhat similar area
        if (sq.area > centerSquare.area * 0.2 && sq.area < centerSquare.area * 5.0) {
            let dx = sq.center.x - centerSquare.center.x;
            let dy = sq.center.y - centerSquare.center.y;
            
            let stepsX = Math.round(dx / expectedWidth);
            let stepsY = Math.round(dy / expectedHeight);
            
            let expectedX = centerSquare.center.x + stepsX * expectedWidth;
            let expectedY = centerSquare.center.y + stepsY * expectedHeight;
            
            let dist = Math.pow(sq.center.x - expectedX, 2) + Math.pow(sq.center.y - expectedY, 2);
            let maxDist = Math.pow(expectedWidth * 0.5, 2) + Math.pow(expectedHeight * 0.5, 2);
            
            // Check if it aligns well with the grid
            if (dist < maxDist) {
                gridSquares.push({ sq, stepsX, stepsY });
            }
        }
    }
    
    if (gridSquares.length === 0) return null;
    
    // Find limits of the grid. It shouldn't exceed 8 in width or height.
    let minX = Math.min(...gridSquares.map(g => g.stepsX));
    let maxX = Math.max(...gridSquares.map(g => g.stepsX));
    let minY = Math.min(...gridSquares.map(g => g.stepsY));
    let maxY = Math.max(...gridSquares.map(g => g.stepsY));
    
    // Simple centering clamp: if span > 8, constrain around the center square (which is at step 0)
    if (maxX - minX + 1 > 8) {
        // assume 0 is roughly the center of the board
        minX = Math.max(minX, -4);
        maxX = Math.min(maxX, 3);
        if (maxX - minX + 1 < 8) {
            if (minX > -4) maxX = minX + 7;
            else minX = maxX - 7;
        }
    }
    if (maxY - minY + 1 > 8) {
        minY = Math.max(minY, -4);
        maxY = Math.min(maxY, 3);
        if (maxY - minY + 1 < 8) {
            if (minY > -4) maxY = minY + 7;
            else minY = maxY - 7;
        }
    }
    
    // Collect final in-bound squares
    let validGridSquares = gridSquares.filter(g => 
        g.stepsX >= minX && g.stepsX <= maxX &&
        g.stepsY >= minY && g.stepsY <= maxY
    );
    
    if (validGridSquares.length === 0) return null;
    
    // Compute expected overall bounding box from the valid squares to account for missed edge squares
    let overallRectX = centerSquare.center.x + (minX - 0.5) * expectedWidth;
    let overallRectY = centerSquare.center.y + (minY - 0.5) * expectedHeight;
    let overallRectW = (maxX - minX + 1) * expectedWidth;
    let overallRectH = (maxY - minY + 1) * expectedHeight;
    
    // Include the actual extremes just to make sure we encapsulate detected edges
    let actualMinX = Math.min(...validGridSquares.map(g => g.sq.rect.x));
    let actualMinY = Math.min(...validGridSquares.map(g => g.sq.rect.y));
    let actualMaxX = Math.max(...validGridSquares.map(g => g.sq.rect.x + g.sq.rect.width));
    let actualMaxY = Math.max(...validGridSquares.map(g => g.sq.rect.y + g.sq.rect.height));
    
    return {
        x: Math.min(overallRectX, actualMinX),
        y: Math.min(overallRectY, actualMinY),
        width: Math.max(overallRectX + overallRectW, actualMaxX) - Math.min(overallRectX, actualMinX),
        height: Math.max(overallRectY + overallRectH, actualMaxY) - Math.min(overallRectY, actualMinY)
    };
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
    
    let rect = USE_CENTER_OUT_HEURISTIC 
        ? findBoundingBoxNew(src, contours, imageArea)
        : findBoundingBoxOld(src, contours, imageArea);
    
    if (rect) {
        let pt1 = new cv.Point(rect.x, rect.y);
        let pt2 = new cv.Point(rect.x + rect.width, rect.y + rect.height);
        // Draw a thick red rectangle
        cv.rectangle(src, pt1, pt2, new cv.Scalar(255, 0, 0, 255), 5);
    } else {
        console.log(`Could not find a bounding box in ${filename}`);
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
        reportMd += `Using Heuristic: ${USE_CENTER_OUT_HEURISTIC ? 'Center-out Grid Expansion' : 'Largest Quad Contour'}\n\n`;
        reportMd += `| Original Image | Detected Board Bounding Box |\n`;
        reportMd += `|----------------|-----------------------------|\n`;
        
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
