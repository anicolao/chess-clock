import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

const inputDir = 'tests/images';
const outputDir = 'tests/images/out';
const reportFile = 'tests/board_localization_report.md';

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
    
    let maxArea = 0;
    let maxContour = null;
    let imageArea = src.rows * src.cols;
    
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
        let pt1 = new cv.Point(rect.x, rect.y);
        let pt2 = new cv.Point(rect.x + rect.width, rect.y + rect.height);
        // Draw a thick red rectangle
        cv.rectangle(src, pt1, pt2, new cv.Scalar(255, 0, 0, 255), 5);
        maxContour.delete();
    } else {
        console.log(`Could not find a prominent contour in ${filename}`);
    }
    
    // Copy data back to Jimp
    image.bitmap.data.set(src.data);
    await image.write(outputPath);
    
    src.delete(); gray.delete(); blurred.delete(); edges.delete(); dilated.delete(); M.delete();
    contours.delete(); hierarchy.delete();
}

cv.onRuntimeInitialized = async () => {
    try {
        const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
        
        let reportMd = `# Chessboard Localization Test Report\n\n`;
        reportMd += `This report verifies the initial board localization step of the image processing pipeline.\n\n`;
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
