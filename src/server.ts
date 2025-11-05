import express from "express";
import { Server as HTTPServer } from "http";
import router from "./router";
import cors from "cors";

class Server {
  private app: ReturnType<typeof express>;
  private server!: HTTPServer;

  constructor() {
    this.app = express();

    this.app.use(cors({
      origin: ['http://localhost:8080', 'http://localhost:8081'],
      credentials: true,
    }));

    this.app.use(express.json());
    this.app.use(router);
  }

  start(): Promise<HTTPServer> {
    return new Promise((resolve) => {
      this.server = this.app.listen(5000, () => {
        console.log("Server started at http://localhost:5000");
        resolve(this.server);
      });

      this.server.on('error', (error) => {
        console.error('Server error:', error);
      });
    });
  }
}

export const server = new Server();
