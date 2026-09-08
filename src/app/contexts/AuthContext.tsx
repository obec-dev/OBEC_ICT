"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';

type UserRole = { personal_role: string; has_school_admin: boolean; sub_role: string; school_id: string | null; district_id: string | null; };
type UserProfile = { full_name: string | null; sub_role: string | null; school_id: string | null; district_id: string | null; personal_role: string; };

type AuthContextType = { user: User | null; profile: UserProfile | null; currentRole: string | null; userRoles: UserRole | null; setCurrentRole: (role: string) => void; loading: boolean; };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ⏱️ ตั้งค่าเวลา Timeout ตรงนี้ที่เดียวครับ (5 นาที = 5 * 60 * 1000)
// ถ้าอยากเทส 10 วินาที ให้เปลี่ยนเป็น = 10 * 1000 ครับ
const TIMEOUT_MS = 3 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentRole, _setCurrentRole] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  // 🟢 1. ระบบรักษาความปลอดภัย: จดเวลาและเตะออก (ทำงานตอนหน้าเว็บเปิด)
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    // ประทับเวลาล่าสุดลง LocalStorage
    const updateActivityTime = () => {
      localStorage.setItem('last_active_time', Date.now().toString());
    };

    // เช็คว่าหมดอายุหรือยัง
    const checkTimeout = async () => {
      const lastActive = localStorage.getItem('last_active_time');
      if (lastActive && user) {
        const timePassed = Date.now() - parseInt(lastActive, 10);
        if (timePassed > TIMEOUT_MS) {
          alert("เซสชันหมดอายุเนื่องจากไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่");
          localStorage.removeItem('last_active_time');
          await supabase.auth.signOut();
        }
      }
    };

    if (user) {
      updateActivityTime(); // เริ่มจับเวลาตั้งแต่วินาทีแรกที่ล็อกอิน

      // ตั้งนาฬิกาปลุกให้เช็คเงียบๆ ทุกๆ 5 วินาที
      intervalId = setInterval(checkTimeout, 5000);

      // ดักจับทุกการเคลื่อนไหวเพื่อต่ออายุ
      const events = ['click', 'keydown', 'scroll', 'touchstart'];
      events.forEach(event => window.addEventListener(event, updateActivityTime));

      return () => {
        clearInterval(intervalId);
        events.forEach(event => window.removeEventListener(event, updateActivityTime));
      };
    }
  }, [user, supabase]);

  // 🟢 2. ระบบโหลดข้อมูลหลัก
  useEffect(() => {
    let mounted = true;

    const loadCache = () => {
      try {
        const cUser = localStorage.getItem('auth_user');
        const cProfile = localStorage.getItem('auth_profile');
        const cRoles = localStorage.getItem('auth_roles');
        const cRole = localStorage.getItem('currentRole');

        if (cUser) setUser(JSON.parse(cUser));
        if (cProfile) setProfile(JSON.parse(cProfile));
        if (cRoles) setUserRoles(JSON.parse(cRoles));
        if (cRole) _setCurrentRole(cRole);
      } catch {
        console.error("Cache read error");
      }
    };

    loadCache();

    const verifyAuth = async () => {
      try {
        const { data: { user: freshUser }, error: authError } = await supabase.auth.getUser();

        if (authError || !freshUser) throw new Error("Session Invalid");

        if (mounted) {
          setUser(freshUser);
          localStorage.setItem('auth_user', JSON.stringify(freshUser));

          const { data: profileData } = await supabase.from('profiles').select('*').eq('id', freshUser.id).single();
          if (profileData) {
            setProfile(profileData);
            localStorage.setItem('auth_profile', JSON.stringify(profileData));
          }

          const { data: rolesData } = await supabase.rpc('get_user_roles');
          if (rolesData) {
            setUserRoles(rolesData);
            localStorage.setItem('auth_roles', JSON.stringify(rolesData));
          }
        }
      } catch {
        if (mounted) {
          setUser(null);
          setProfile(null);
          setUserRoles(null);
          localStorage.removeItem('auth_user');
          localStorage.removeItem('auth_profile');
          localStorage.removeItem('auth_roles');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    const initAuth = async () => {
      try {
        // 🚨 ด่านตรวจคนเข้าเมือง: ถ้าปิดเบราว์เซอร์ไปนานเกินเวลา เชือดทิ้งทันที!
        const lastActive = localStorage.getItem('last_active_time');
        if (lastActive) {
          const timePassed = Date.now() - parseInt(lastActive, 10);
          if (timePassed > TIMEOUT_MS) {
            console.log("🔒 ตรวจพบการหมดอายุขณะปิดหน้าเว็บ กำลังเคลียร์เซสชัน...");
            localStorage.removeItem('last_active_time');
            await supabase.auth.signOut(); // สั่ง Logout ก่อนเลย
            return; // หยุดการทำงานของ Auth ไม่ให้ไปดึงข้อมูลต่อ
          }
        }

        const { data: { user } } = await supabase.auth.getUser();

        if (user && mounted) {
          setUser(user);
          await verifyAuth();
        } else if (mounted) {
          setUser(null);
          setProfile(null);
          setUserRoles(null);
          localStorage.removeItem('auth_user');
          localStorage.removeItem('auth_profile');
          localStorage.removeItem('auth_roles');
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setUserRoles(null);
        localStorage.clear(); // ล้างให้เกลี้ยง รวมถึง timestamp ด้วย
        router.push('/');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          setUser(session.user);
          localStorage.setItem('auth_user', JSON.stringify(session.user));
          if (event === 'SIGNED_IN') verifyAuth();
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCurrentRole = (role: string | null) => {
    if (role) {
      localStorage.setItem('currentRole', role);
      _setCurrentRole(role);
      router.push('/');
    } else {
      localStorage.removeItem('currentRole');
      _setCurrentRole(null);
    }
  };

  const value = { user, profile, currentRole, userRoles, setCurrentRole, loading };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
