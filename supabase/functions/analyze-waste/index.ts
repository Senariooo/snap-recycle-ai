import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image } = await req.json();
    if (!image) {
      return new Response(JSON.stringify({ error: "Görsel gerekli" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Extract base64 data (remove data:image/...;base64, prefix if present)
    const base64Data = image.includes(",") ? image.split(",")[1] : image;
    const mimeMatch = image.match(/data:(image\/\w+);base64/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Sen bir atık analiz uzmanısın. Kullanıcının gönderdiği fotoğraftaki atığı analiz et ve aşağıdaki JSON formatında yanıt ver. Yanıtın SADECE JSON olmalı, başka bir şey yazma.

{
  "material": "Atığın materyal türü (Plastik, Cam, Kağıt, Metal, Elektronik, Tekstil, Organik, Tehlikeli Atık vb.)",
  "recyclable": true/false,
  "confidence": 0-100 arası güven yüzdesi,
  "description": "Atığın kısa açıklaması ve geri dönüşüm bilgisi (2-3 cümle, Türkçe)",
  "upcycleIdea": "Bu atık için yaratıcı bir ileri dönüşüm (upcycle) fikri (1-2 cümle, Türkçe)",
  "carbonSaving": "Bu atığı geri dönüştürmenin karbon tasarrufu etkisi (1 cümle, Türkçe, somut rakamlarla)"
}`
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                },
              },
              {
                type: "text",
                text: "Bu fotoğraftaki atığı analiz et.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Çok fazla istek gönderildi, lütfen biraz bekleyin." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Kredi yetersiz, lütfen bakiye yükleyin." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI analiz hatası");
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = {
        material: "Bilinmiyor",
        recyclable: false,
        confidence: 0,
        description: content || "Analiz yapılamadı.",
        upcycleIdea: "",
        carbonSaving: "",
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-waste error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Bilinmeyen hata" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
