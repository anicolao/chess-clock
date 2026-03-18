import fs from 'fs';
import path from 'path';
import cv from '@techstark/opencv-js';
import { Jimp } from 'jimp';

const inputBaseDir = 'tests/images';
const outputBaseDir = 'tests/images/out';
const reportFile = 'tests/board_localization_report.md';

function distance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function getQuadCenter(pts) {
    let x = 0, y = 0;
    for (let i = 0; i < 4; i++) {
        x += pts[i].x;
        y += pts[i].y;
    }
    return { x: x / 4, y: y / 4 };
}

function evaluateGridCorners(gray, corners, cols, rows) {
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 8, 0, 8, 8, 0, 8]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y,
        corners[1].x, corners[1].y,
        corners[2].x, corners[2].y,
        corners[3].x, corners[3].y
    ]);
    let transform = cv.getPerspectiveTransform(srcTri, dstTri);

    let evenIntensities = [];
    let oddIntensities = [];
    let valid = true;

    for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
            for (let dx = 0.25; dx <= 0.75; dx += 0.25) {
                for (let dy = 0.25; dy <= 0.75; dy += 0.25) {
                    let cx = x + dx;
                    let cy = y + dy;
                    
                    let ptMat = cv.matFromArray(1, 1, cv.CV_32FC2, [cx, cy]);
                    let dstMat = new cv.Mat();
                    cv.perspectiveTransform(ptMat, dstMat, transform);
                    
                    let px = dstMat.data32F[0];
                    let py = dstMat.data32F[1];
                    
                    ptMat.delete(); dstMat.delete();

                    if (px < 0 || px >= cols || py < 0 || py >= rows) {
                        valid = false;
                        break;
                    }

                    let intensity = gray.ucharPtr(Math.floor(py), Math.floor(px))[0];
                    if ((x + y) % 2 === 0) {
                        evenIntensities.push(intensity);
                    } else {
                        oddIntensities.push(intensity);
                    }
                }
                if (!valid) break;
            }
            if (!valid) break;
        }
        if (!valid) break;
    }

    srcTri.delete(); dstTri.delete(); transform.delete();

    if (!valid || evenIntensities.length === 0 || oddIntensities.length === 0) return -1;

    let evenMean = evenIntensities.reduce((a, b) => a + b, 0) / evenIntensities.length;
    let oddMean = oddIntensities.reduce((a, b) => a + b, 0) / oddIntensities.length;
    return Math.abs(evenMean - oddMean);
}

function optimizeCorners(gray, initialCorners, cols, rows) {
    let bestCorners = initialCorners.map(p => ({x: p.x, y: p.y}));
    let bestScore = evaluateGridCorners(gray, bestCorners, cols, rows);
    
    let stepSize = 10;
    while (stepSize >= 1) {
        let improved = false;
        for (let i = 0; i < 4; i++) {
            let directions = [
                {x: stepSize, y: 0}, {x: -stepSize, y: 0},
                {x: 0, y: stepSize}, {x: 0, y: -stepSize},
                {x: stepSize, y: stepSize}, {x: -stepSize, y: -stepSize},
                {x: stepSize, y: -stepSize}, {x: -stepSize, y: stepSize}
            ];
            
            for (let dir of directions) {
                let testCorners = bestCorners.map((p, idx) => idx === i ? {x: p.x + dir.x, y: p.y + dir.y} : {x: p.x, y: p.y});
                let score = evaluateGridCorners(gray, testCorners, cols, rows);
                if (score > bestScore) {
                    bestScore = score;
                    bestCorners = testCorners;
                    improved = true;
                }
            }
        }
        if (!improved) {
            stepSize = Math.floor(stepSize / 2);
        }
    }
    return bestCorners;
}

function findBoardQuad(src, gray, contours, imageArea) {
    let quads = [];
    let imageCenter = { x: src.cols / 2, y: src.rows / 2 };

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt, false);
        
        if (area > imageArea * 0.0005 && area < imageArea * 0.1) {
            let tmp = new cv.Mat();
            let perimeter = cv.arcLength(cnt, true);
            cv.approxPolyDP(cnt, tmp, 0.03 * perimeter, true);
            
            if (tmp.rows === 4 && cv.isContourConvex(tmp)) {
                let pts = [];
                for (let j = 0; j < 4; j++) {
                    pts.push({ x: tmp.data32S[j * 2], y: tmp.data32S[j * 2 + 1] });
                }
                pts.sort((a, b) => a.y - b.y);
                let top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
                let bottom = pts.slice(2, 4).sort((a, b) => b.x - a.x);
                pts = [...top, ...bottom];

                quads.push({
                    pts: pts,
                    center: getQuadCenter(pts),
                    area: area
                });
            }
            tmp.delete();
        }
    }
    
    quads.sort((a, b) => distance(a.center, imageCenter) - distance(b.center, imageCenter));
    
    let bestInitialCorners = null;
    let maxInitialScore = -1;

    for (let q = 0; q < Math.min(quads.length, 100); q++) {
        let quad = quads[q];
        
        let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1, 0, 1, 1, 0, 1]);
        let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
            quad.pts[0].x, quad.pts[0].y,
            quad.pts[1].x, quad.pts[1].y,
            quad.pts[2].x, quad.pts[2].y,
            quad.pts[3].x, quad.pts[3].y
        ]);
        let transform = cv.getPerspectiveTransform(srcTri, dstTri);

        for (let offsetX = 0; offsetX < 8; offsetX++) {
            for (let offsetY = 0; offsetY < 8; offsetY++) {
                let bounds = [
                    {x: -offsetX, y: -offsetY},
                    {x: 8 - offsetX, y: -offsetY},
                    {x: 8 - offsetX, y: 8 - offsetY},
                    {x: -offsetX, y: 8 - offsetY}
                ];

                let boundPts = [];
                for (let b of bounds) {
                    let ptMat = cv.matFromArray(1, 1, cv.CV_32FC2, [b.x, b.y]);
                    let dstMat = new cv.Mat();
                    cv.perspectiveTransform(ptMat, dstMat, transform);
                    boundPts.push({x: dstMat.data32F[0], y: dstMat.data32F[1]});
                    ptMat.delete(); dstMat.delete();
                }
                
                let score = evaluateGridCorners(gray, boundPts, src.cols, src.rows);
                if (score > maxInitialScore && score > 30) {
                    maxInitialScore = score;
                    bestInitialCorners = boundPts;
                }
            }
        }
        srcTri.delete(); dstTri.delete(); transform.delete();
        if (maxInitialScore > 80) break;
    }

    if (bestInitialCorners) {
        return optimizeCorners(gray, bestInitialCorners, src.cols, src.rows);
    }
    
    return null;
}

async function processImage(relativePath) {
    const inputPath = path.join(inputBaseDir, relativePath);
    const outputPath = path.join(outputBaseDir, relativePath);
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`Processing ${relativePath}...`);
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
    
    let quadPts = findBoardQuad(src, gray, contours, imageArea);
    
    if (quadPts) {
        for (let i = 0; i < 4; i++) {
            let pt1 = new cv.Point(quadPts[i].x, quadPts[i].y);
            let pt2 = new cv.Point(quadPts[(i + 1) % 4].x, quadPts[(i + 1) % 4].y);
            cv.line(src, pt1, pt2, new cv.Scalar(0, 255, 0, 255), 5);
        }
    } else {
        console.log(`Could not find a valid 8x8 chessboard pattern bounding box in ${relativePath}`);
    }
    
    image.bitmap.data.set(src.data);
    await image.write(outputPath);
    
    src.delete(); gray.delete(); blurred.delete(); edges.delete(); dilated.delete(); M.delete();
    contours.delete(); hierarchy.delete();
}

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (file !== 'out' && file !== '8col' && file !== 'empty') {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            if (file.endsWith(".jpg") || file.endsWith(".png")) {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        }
    });

    return arrayOfFiles;
}

cv.onRuntimeInitialized = async () => {
    try {
        const allFiles = getAllFiles(inputBaseDir);
        const relativeFiles = allFiles.map(f => path.relative(inputBaseDir, f));
        
        let reportMd = `# Chessboard Localization Test Report\n\n`;
        reportMd += `This report verifies the initial board localization step of the image processing pipeline.\n`;
        reportMd += `Using Algorithm: Seed Square Extrapolation & 8x8 Checkerboard Validation\n\n`;
        reportMd += `| Original Image | Detected Board Quadrilateral |\n`;
        reportMd += `|----------------|------------------------------|\n`;
        
        for (const file of relativeFiles) {
            await processImage(file);
            reportMd += `| ![Original](images/${file}) | ![Annotated](images/out/${file}) |\n`;
        }
        
        fs.writeFileSync(reportFile, reportMd);
        console.log(`\nReport generated at ${reportFile}`);
    } catch (err) {
        console.error("Error during processing:", err);
    }
};
