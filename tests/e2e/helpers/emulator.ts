import * as http from 'http';

export class CameraEmulator {
    private server: http.Server;
    public port: number = 0;

    constructor() {
        this.server = http.createServer((req, res) => {
            // Set CORS headers so the web app can reach it
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.url === '/api/status' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
            } else {
                res.writeHead(404);
                res.end();
            }
        });
    }

    start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(0, () => {
                const addr = this.server.address();
                if (addr && typeof addr !== 'string') {
                    this.port = addr.port;
                }
                resolve();
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}
