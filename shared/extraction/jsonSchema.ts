export const extractionResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["updates", "sessionTitle"],
  properties: {
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "operation",
          "targetSlug",
          "targetTitle",
          "targetType",
          "summary",
          "body",
          "tags",
          "links",
          "evidence",
          "confidence"
        ],
        properties: {
          operation: {
            type: "string",
            enum: ["create", "append", "rewrite", "noop"]
          },
          targetSlug: {
            type: "string"
          },
          targetTitle: {
            type: "string"
          },
          targetType: {
            type: "string",
            enum: ["concept", "entity", "source-summary", "synthesis"]
          },
          summary: {
            type: "string"
          },
          body: {
            type: "string"
          },
          tags: {
            type: "array",
            items: {
              type: "string"
            }
          },
          links: {
            type: "array",
            items: {
              type: "string"
            }
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "ref"],
              properties: {
                kind: {
                  type: "string",
                  enum: ["transcript", "source", "note"]
                },
                ref: {
                  type: "string"
                },
                summary: {
                  type: "string"
                }
              }
            }
          },
          confidence: {
            type: "number"
          }
        }
      }
    },
    sessionTitle: {
      type: "string"
    }
  }
} as const;
