"use client";

import Link from "next/link";

export default function RegisterSuccessPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] flex items-center justify-center text-2xl font-bold">
          ✓
        </div>
        <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-4">ลงทะเบียนสำเร็จ</h1>
        <p className="text-gray-600 leading-relaxed mb-3">
          ระบบได้รับข้อมูลการลงทะเบียนของท่านเรียบร้อยแล้ว
          ในระยะนี้เป็นการเปิดรับลงทะเบียนเท่านั้น
        </p>
        <p className="text-gray-800 font-semibold mb-2">
          วันเปิดให้เข้าสู่ระบบเรียน/สอบ จะประกาศให้ทราบภายหลัง
        </p>
        <p className="text-sm text-gray-500 mb-8">
          หากต้องการแก้ไขข้อมูล กรุณาติดต่อผู้ดูแลระบบ
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="rounded-full bg-[var(--primary-blue)] text-white px-8 py-3 font-bold hover:-translate-y-0.5 transition-all"
          >
            ดูภาพรวม
          </Link>
          <Link
            href="/"
            className="rounded-full border-2 border-[var(--primary-blue)] text-[var(--primary-blue)] px-8 py-3 font-bold hover:bg-blue-50 transition-all"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
