import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function POST(req: Request) {
  try {
    const { s3Key } = await req.json();

    if (!s3Key) {
      return NextResponse.json({ error: "Missing s3Key" }, { status: 400 });
    }

    // ADD THIS DEBUG LOG:
    console.log("S3 Download Request:", {
      s3Key,
      bucket: process.env.AWS_S3_BUCKET,
      hasBucket: !!process.env.AWS_S3_BUCKET
    });

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: s3Key,
    });

    const response = await s3.send(command);

    const body = response.Body as Readable;
    const buffer = await streamToBuffer(body);

    console.log("S3 Download Success:", { size: buffer.length }); // ADD THIS

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": response.ContentType || "application/octet-stream",
      },
    });
  } catch (err: any) {
    // IMPROVED ERROR LOGGING:
    console.error("S3 Download Error Details:", {
      errorName: err.name,
      errorMessage: err.message,
      errorCode: err.Code,
      s3Key: req.body ? (await req.json()).s3Key : 'unknown'
    });
    
    return NextResponse.json(
      { 
        error: "Failed to download file",
        details: err.message,
        code: err.Code || err.name
      },
      { status: 500 }
    );
  }
}