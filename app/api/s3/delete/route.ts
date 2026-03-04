import { NextResponse } from "next/server";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function DELETE(req: Request) {
  try {
    const { s3Key } = await req.json();

    console.log("DELETE S3 Request:", { s3Key, bucket: process.env.AWS_S3_BUCKET }); // ADD THIS

    if (!s3Key) {
      return NextResponse.json({ error: "Missing s3Key" }, { status: 400 });
    }

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: s3Key,
    });

    await s3.send(command);
    
    console.log("DELETE S3 Success for:", s3Key); // ADD THIS

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE S3 Error:", { // BETTER LOGGING
      name: err.name,
      message: err.message,
      code: err.Code,
      stack: err.stack
    });
    
    return NextResponse.json(
      { 
        error: "Failed to delete file",
        details: err.message,
        code: err.name
      },
      { status: 500 }
    );
  }

}