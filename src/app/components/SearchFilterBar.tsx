"use client";

import { inputClass } from "@/lib/styles";
import { Combobox } from "./Combobox";

type SearchFilterBarProps = {
  schoolQuery: string;
  areaZone: string;
  province: string;
  areaOptions: string[];
  provinceOptions: string[];
  onSchoolQueryChange: (value: string) => void;
  onAreaZoneChange: (value: string) => void;
  onProvinceChange: (value: string) => void;
};

export function SearchFilterBar({
  schoolQuery,
  areaZone,
  province,
  areaOptions,
  provinceOptions,
  onSchoolQueryChange,
  onAreaZoneChange,
  onProvinceChange,
}: SearchFilterBarProps) {
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ค้นหาชื่อโรงเรียน</label>
          <input
            className={inputClass}
            value={schoolQuery}
            placeholder="พิมพ์ชื่อโรงเรียน..."
            onChange={(e) => onSchoolQueryChange(e.target.value)}
          />
        </div>
        <Combobox
          label="เขตพื้นที่"
          value={areaZone}
          options={areaOptions}
          placeholder="เลือกเขตพื้นที่"
          onChange={onAreaZoneChange}
        />
        <Combobox
          label="จังหวัด"
          value={province}
          options={provinceOptions}
          placeholder="เลือกจังหวัด"
          onChange={onProvinceChange}
        />
      </div>
    </div>
  );
}
