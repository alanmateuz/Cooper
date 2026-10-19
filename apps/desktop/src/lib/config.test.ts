import { describe, expect, it } from "vitest";
import { decodeConnectionCode, encodeConnectionCode, validAnonKey, validServerUrl } from "./config";

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.assinatura`;

describe("validServerUrl", () => {
  it("aceita Supabase hospedado e local", () => {
    expect(validServerUrl("https://abcd.supabase.co")).toBe("https://abcd.supabase.co");
    expect(validServerUrl(" https://abcd.supabase.co/ ")).toBe("https://abcd.supabase.co");
    expect(validServerUrl("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(validServerUrl("http://localhost:54321")).toBe("http://localhost:54321");
  });

  it("recusa outros hosts, http remoto e caminhos", () => {
    expect(validServerUrl("http://abcd.supabase.co")).toBeNull();
    expect(validServerUrl("https://supabase.co.evil.com")).toBeNull();
    expect(validServerUrl("https://abcd.supabase.co/rest/v1")).toBeNull();
    expect(validServerUrl("não é url")).toBeNull();
  });
});

describe("validAnonKey", () => {
  it("aceita chave anon e publicável", () => {
    expect(validAnonKey(jwt({ role: "anon" }))).not.toBeNull();
    expect(validAnonKey("sb_publishable_abcdefghij123")).not.toBeNull();
  });

  it("recusa service_role e lixo", () => {
    expect(validAnonKey(jwt({ role: "service_role" }))).toBeNull();
    expect(validAnonKey("sb_secret_abcdefghij123")).toBeNull();
    expect(validAnonKey("abc")).toBeNull();
  });
});

describe("código de conexão", () => {
  it("ida e volta", () => {
    const c = { url: "https://abcd.supabase.co", anonKey: jwt({ role: "anon" }) };
    const code = encodeConnectionCode(c);
    expect(code.startsWith("cooper1.")).toBe(true);
    expect(code).not.toMatch(/[+/=]/);
    expect(decodeConnectionCode(`  ${code}\n`)).toEqual(c);
  });

  it("recusa código adulterado ou com servidor inválido", () => {
    expect(decodeConnectionCode("cooper1.@@@")).toBeNull();
    expect(decodeConnectionCode("cooper2.abc")).toBeNull();
    const evil = encodeConnectionCode({ url: "https://evil.com", anonKey: jwt({ role: "anon" }) });
    expect(decodeConnectionCode(evil)).toBeNull();
  });
});
