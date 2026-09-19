export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_harvest_snapshots: {
        Row: {
          boy_value: number
          contact_id: string
          created_at: string
          created_by: string | null
          current_harvest: number
          current_value: number
          holding_tank_id: string | null
          id: string
          notes: string | null
          reporting_year: number
          ror_1y: number | null
          ror_3y: number | null
          ror_5y: number | null
          ror_6m: number | null
          ror_since_inception: number | null
          ror_ytd: number | null
          snapshot_date: string
          storehouse_id: string | null
          updated_at: string
          vineyard_account_id: string | null
          ytd_value: number
        }
        Insert: {
          boy_value?: number
          contact_id: string
          created_at?: string
          created_by?: string | null
          current_harvest?: number
          current_value?: number
          holding_tank_id?: string | null
          id?: string
          notes?: string | null
          reporting_year?: number
          ror_1y?: number | null
          ror_3y?: number | null
          ror_5y?: number | null
          ror_6m?: number | null
          ror_since_inception?: number | null
          ror_ytd?: number | null
          snapshot_date?: string
          storehouse_id?: string | null
          updated_at?: string
          vineyard_account_id?: string | null
          ytd_value?: number
        }
        Update: {
          boy_value?: number
          contact_id?: string
          created_at?: string
          created_by?: string | null
          current_harvest?: number
          current_value?: number
          holding_tank_id?: string | null
          id?: string
          notes?: string | null
          reporting_year?: number
          ror_1y?: number | null
          ror_3y?: number | null
          ror_5y?: number | null
          ror_6m?: number | null
          ror_since_inception?: number | null
          ror_ytd?: number | null
          snapshot_date?: string
          storehouse_id?: string | null
          updated_at?: string
          vineyard_account_id?: string | null
          ytd_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_harvest_snapshots_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_harvest_snapshots_holding_tank_id_fkey"
            columns: ["holding_tank_id"]
            isOneToOne: false
            referencedRelation: "holding_tank"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_harvest_snapshots_storehouse_id_fkey"
            columns: ["storehouse_id"]
            isOneToOne: false
            referencedRelation: "storehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_harvest_snapshots_vineyard_account_id_fkey"
            columns: ["vineyard_account_id"]
            isOneToOne: false
            referencedRelation: "vineyard_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      adobe_webforms: {
        Row: {
          created_at: string
          created_by: string | null
          custodian: string | null
          fields: Json
          id: string
          is_active: boolean
          name: string
          updated_at: string
          widget_url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custodian?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          widget_url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custodian?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          widget_url?: string
        }
        Relationships: []
      }
      asana_sync_events: {
        Row: {
          contact_id: string | null
          created_at: string
          event_key: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          event_key: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          event_key?: string
        }
        Relationships: []
      }
      asana_sync_state: {
        Row: {
          contact_id: string
          last_synced_at: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          last_synced_at?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          last_synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asana_sync_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_tsv: unknown
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string
          heading: string | null
          id: string
          token_estimate: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          content_tsv?: unknown
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string
          heading?: string | null
          id?: string
          token_estimate?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          content_tsv?: unknown
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string
          heading?: string | null
          id?: string
          token_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brain_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "brain_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_documents: {
        Row: {
          body: string | null
          chunk_count: number
          content_hash: string | null
          created_at: string
          created_by: string | null
          doc_type: string
          external_id: string | null
          file_name: string | null
          id: string
          index_error: string | null
          index_status: string
          indexed_at: string | null
          is_active: boolean
          mime_type: string | null
          occurred_at: string | null
          pinned: boolean
          sensitivity: string
          source_record_id: string | null
          source_system: string
          source_table: string | null
          source_url: string | null
          storage_bucket: string | null
          storage_path: string | null
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          external_id?: string | null
          file_name?: string | null
          id?: string
          index_error?: string | null
          index_status?: string
          indexed_at?: string | null
          is_active?: boolean
          mime_type?: string | null
          occurred_at?: string | null
          pinned?: boolean
          sensitivity?: string
          source_record_id?: string | null
          source_system?: string
          source_table?: string | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          external_id?: string | null
          file_name?: string | null
          id?: string
          index_error?: string | null
          index_status?: string
          indexed_at?: string | null
          is_active?: boolean
          mime_type?: string | null
          occurred_at?: string | null
          pinned?: boolean
          sensitivity?: string
          source_record_id?: string | null
          source_system?: string
          source_table?: string | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      brain_entity_links: {
        Row: {
          created_at: string
          document_id: string
          entity_id: string
          entity_type: string
          id: string
          link_source: string
        }
        Insert: {
          created_at?: string
          document_id: string
          entity_id: string
          entity_type: string
          id?: string
          link_source?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          link_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_entity_links_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "brain_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_queries: {
        Row: {
          answer: string | null
          chunk_ids: string[]
          citations: Json
          created_at: string
          id: string
          latency_ms: number | null
          question: string
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          chunk_ids?: string[]
          citations?: Json
          created_at?: string
          id?: string
          latency_ms?: number | null
          question: string
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          chunk_ids?: string[]
          citations?: Json
          created_at?: string
          id?: string
          latency_ms?: number | null
          question?: string
          user_id?: string | null
        }
        Relationships: []
      }
      business_pipeline: {
        Row: {
          amount: number
          aum_amount: number
          category: Database["public"]["Enums"]["pipeline_category"]
          commission_amount: number
          contact_id: string
          created_at: string
          created_by: string
          expected_close_date: string | null
          id: string
          insurance_coverage_amount: number
          notes: string | null
          status: Database["public"]["Enums"]["pipeline_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          aum_amount?: number
          category: Database["public"]["Enums"]["pipeline_category"]
          commission_amount?: number
          contact_id: string
          created_at?: string
          created_by: string
          expected_close_date?: string | null
          id?: string
          insurance_coverage_amount?: number
          notes?: string | null
          status?: Database["public"]["Enums"]["pipeline_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          aum_amount?: number
          category?: Database["public"]["Enums"]["pipeline_category"]
          commission_amount?: number
          contact_id?: string
          created_at?: string
          created_by?: string
          expected_close_date?: string | null
          id?: string
          insurance_coverage_amount?: number
          notes?: string | null
          status?: Database["public"]["Enums"]["pipeline_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_pipeline_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      cashflow_analyses: {
        Row: {
          burn_rate: Json | null
          category_breakdown: Json | null
          created_at: string
          created_by: string
          file_paths: string[] | null
          household_id: string
          id: string
          liquidity_status: Json | null
          logic_trace: string | null
          outliers: Json | null
          period_end: string | null
          period_start: string | null
          proposed_tasks: Json | null
          raw_report: string | null
          status: string
          updated_at: string
        }
        Insert: {
          burn_rate?: Json | null
          category_breakdown?: Json | null
          created_at?: string
          created_by: string
          file_paths?: string[] | null
          household_id: string
          id?: string
          liquidity_status?: Json | null
          logic_trace?: string | null
          outliers?: Json | null
          period_end?: string | null
          period_start?: string | null
          proposed_tasks?: Json | null
          raw_report?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          burn_rate?: Json | null
          category_breakdown?: Json | null
          created_at?: string
          created_by?: string
          file_paths?: string[] | null
          household_id?: string
          id?: string
          liquidity_status?: Json | null
          logic_trace?: string | null
          outliers?: Json | null
          period_end?: string | null
          period_start?: string | null
          proposed_tasks?: Json | null
          raw_report?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_analyses_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_email_links: {
        Row: {
          click_count: number
          clicked_at: string | null
          created_at: string
          email_id: string
          id: string
          last_clicked_at: string | null
          target_url: string
        }
        Insert: {
          click_count?: number
          clicked_at?: string | null
          created_at?: string
          email_id: string
          id?: string
          last_clicked_at?: string | null
          target_url: string
        }
        Update: {
          click_count?: number
          clicked_at?: string | null
          created_at?: string
          email_id?: string
          id?: string
          last_clicked_at?: string | null
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_email_links_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "contact_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_emails: {
        Row: {
          contact_id: string
          created_at: string
          gmail_message_id: string | null
          gmail_thread_id: string | null
          id: string
          last_opened_at: string | null
          open_count: number
          opened_at: string | null
          sender_user_id: string
          sent_at: string
          subject: string
          to_email: string
          tracking_token: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_opened_at?: string | null
          open_count?: number
          opened_at?: string | null
          sender_user_id: string
          sent_at?: string
          subject: string
          to_email: string
          tracking_token?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_opened_at?: string | null
          open_count?: number
          opened_at?: string | null
          sender_user_id?: string
          sent_at?: string
          subject?: string
          to_email?: string
          tracking_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_emails_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          accountant_firm: string | null
          accountant_name: string | null
          address: string | null
          asana_url: string | null
          charter_url: string | null
          created_at: string
          created_by: string
          email: string | null
          email_notifications_enabled: boolean
          executor_firm: string | null
          executor_name: string | null
          family_id: string | null
          family_role: Database["public"]["Enums"]["family_role"]
          first_name: string
          full_name: string
          google_drive_url: string | null
          household_id: string | null
          household_members: Json | null
          ia_financial_url: string | null
          id: string
          is_minor: boolean
          just_wealth_url: string | null
          last_name: string | null
          lawyer_firm: string | null
          lawyer_name: string | null
          phone: string | null
          poa_firm: string | null
          poa_name: string | null
          quiet_period_start_date: string | null
          updated_at: string
          vault_root_folder_id: string | null
          vault_shoebox_only: boolean
          vineyard_balance_sheet_summary: string | null
          vineyard_ebitda: number | null
          vineyard_operating_income: number | null
        }
        Insert: {
          accountant_firm?: string | null
          accountant_name?: string | null
          address?: string | null
          asana_url?: string | null
          charter_url?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          email_notifications_enabled?: boolean
          executor_firm?: string | null
          executor_name?: string | null
          family_id?: string | null
          family_role?: Database["public"]["Enums"]["family_role"]
          first_name?: string
          full_name: string
          google_drive_url?: string | null
          household_id?: string | null
          household_members?: Json | null
          ia_financial_url?: string | null
          id?: string
          is_minor?: boolean
          just_wealth_url?: string | null
          last_name?: string | null
          lawyer_firm?: string | null
          lawyer_name?: string | null
          phone?: string | null
          poa_firm?: string | null
          poa_name?: string | null
          quiet_period_start_date?: string | null
          updated_at?: string
          vault_root_folder_id?: string | null
          vault_shoebox_only?: boolean
          vineyard_balance_sheet_summary?: string | null
          vineyard_ebitda?: number | null
          vineyard_operating_income?: number | null
        }
        Update: {
          accountant_firm?: string | null
          accountant_name?: string | null
          address?: string | null
          asana_url?: string | null
          charter_url?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          email_notifications_enabled?: boolean
          executor_firm?: string | null
          executor_name?: string | null
          family_id?: string | null
          family_role?: Database["public"]["Enums"]["family_role"]
          first_name?: string
          full_name?: string
          google_drive_url?: string | null
          household_id?: string | null
          household_members?: Json | null
          ia_financial_url?: string | null
          id?: string
          is_minor?: boolean
          just_wealth_url?: string | null
          last_name?: string | null
          lawyer_firm?: string | null
          lawyer_name?: string | null
          phone?: string | null
          poa_firm?: string | null
          poa_name?: string | null
          quiet_period_start_date?: string | null
          updated_at?: string
          vault_root_folder_id?: string | null
          vault_shoebox_only?: boolean
          vineyard_balance_sheet_summary?: string | null
          vineyard_ebitda?: number | null
          vineyard_operating_income?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      content_platform_versions: {
        Row: {
          body: string
          created_at: string
          external_url: string | null
          id: string
          platform: Database["public"]["Enums"]["content_platform"]
          post_id: string
          published: boolean
          published_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          external_url?: string | null
          id?: string
          platform: Database["public"]["Enums"]["content_platform"]
          post_id: string
          published?: boolean
          published_at?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          external_url?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["content_platform"]
          post_id?: string
          published?: boolean
          published_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_platform_versions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "content_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_posts: {
        Row: {
          assigned_to: string | null
          body: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          published_at: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          body?: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      corporate_shareholders: {
        Row: {
          child_corporation_id: string
          created_at: string
          id: string
          notes: string | null
          ownership_percentage: number
          parent_corporation_id: string
          share_class: string | null
          updated_at: string
        }
        Insert: {
          child_corporation_id: string
          created_at?: string
          id?: string
          notes?: string | null
          ownership_percentage?: number
          parent_corporation_id: string
          share_class?: string | null
          updated_at?: string
        }
        Update: {
          child_corporation_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          ownership_percentage?: number
          parent_corporation_id?: string
          share_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_shareholders_child_corporation_id_fkey"
            columns: ["child_corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_shareholders_parent_corporation_id_fkey"
            columns: ["parent_corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_vineyard_accounts: {
        Row: {
          account_name: string
          account_number: string | null
          account_type: string
          corporation_id: string
          created_at: string
          current_value: number | null
          custodian: string | null
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          account_number?: string | null
          account_type?: string
          corporation_id: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string | null
          account_type?: string
          corporation_id?: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_vineyard_accounts_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
        ]
      }
      corporations: {
        Row: {
          asana_project_url: string | null
          corporation_type: Database["public"]["Enums"]["corporation_type"]
          created_at: string
          created_by: string
          fiscal_year_end: string | null
          id: string
          jurisdiction: string | null
          name: string
          notes: string | null
          sidedrawer_url: string | null
          updated_at: string
        }
        Insert: {
          asana_project_url?: string | null
          corporation_type?: Database["public"]["Enums"]["corporation_type"]
          created_at?: string
          created_by: string
          fiscal_year_end?: string | null
          id?: string
          jurisdiction?: string | null
          name: string
          notes?: string | null
          sidedrawer_url?: string | null
          updated_at?: string
        }
        Update: {
          asana_project_url?: string | null
          corporation_type?: Database["public"]["Enums"]["corporation_type"]
          created_at?: string
          created_by?: string
          fiscal_year_end?: string | null
          id?: string
          jurisdiction?: string | null
          name?: string
          notes?: string | null
          sidedrawer_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_intake_pushes: {
        Row: {
          callback_payload: Json | null
          created_at: string
          error: string | null
          family_folder_url: string | null
          family_id: string | null
          household_folder_url: string | null
          household_id: string
          id: string
          pushed_by: string | null
          request_payload: Json | null
          response_body: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          callback_payload?: Json | null
          created_at?: string
          error?: string | null
          family_folder_url?: string | null
          family_id?: string | null
          household_folder_url?: string | null
          household_id: string
          id?: string
          pushed_by?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          callback_payload?: Json | null
          created_at?: string
          error?: string | null
          family_folder_url?: string | null
          family_id?: string | null
          household_folder_url?: string | null
          household_id?: string
          id?: string
          pushed_by?: string | null
          request_payload?: Json | null
          response_body?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_intake_pushes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_intake_pushes_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_briefings: {
        Row: {
          briefing_date: string
          created_at: string
          facts: Json
          generated_at: string | null
          generation_error: string | null
          generation_status: string
          greeting: string | null
          id: string
          priority_items: Json
          staff_user_id: string
          summary_line: string | null
          updated_at: string
        }
        Insert: {
          briefing_date: string
          created_at?: string
          facts?: Json
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          greeting?: string | null
          id?: string
          priority_items?: Json
          staff_user_id: string
          summary_line?: string | null
          updated_at?: string
        }
        Update: {
          briefing_date?: string
          created_at?: string
          facts?: Json
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          greeting?: string | null
          id?: string
          priority_items?: Json
          staff_user_id?: string
          summary_line?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_recaps: {
        Row: {
          ai_draft: string | null
          author_id: string
          body: string | null
          created_at: string
          id: string
          recap_date: string
          updated_at: string
        }
        Insert: {
          ai_draft?: string | null
          author_id: string
          body?: string | null
          created_at?: string
          id?: string
          recap_date: string
          updated_at?: string
        }
        Update: {
          ai_draft?: string | null
          author_id?: string
          body?: string | null
          created_at?: string
          id?: string
          recap_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      discovery_leads: {
        Row: {
          anxiety_anchor: string | null
          created_at: string
          discovery_notes: string | null
          email: string | null
          family_id: string | null
          first_name: string
          id: string
          phone: string | null
          pipeda_consent: boolean
          pipeda_consented_at: string | null
          sovereignty_status: string
          transition_type: string | null
          updated_at: string
          vineyard_summary: string | null
          vision_summary: string | null
        }
        Insert: {
          anxiety_anchor?: string | null
          created_at?: string
          discovery_notes?: string | null
          email?: string | null
          family_id?: string | null
          first_name: string
          id?: string
          phone?: string | null
          pipeda_consent?: boolean
          pipeda_consented_at?: string | null
          sovereignty_status?: string
          transition_type?: string | null
          updated_at?: string
          vineyard_summary?: string | null
          vision_summary?: string | null
        }
        Update: {
          anxiety_anchor?: string | null
          created_at?: string
          discovery_notes?: string | null
          email?: string | null
          family_id?: string | null
          first_name?: string
          id?: string
          phone?: string | null
          pipeda_consent?: boolean
          pipeda_consented_at?: string | null
          sovereignty_status?: string
          transition_type?: string | null
          updated_at?: string
          vineyard_summary?: string | null
          vision_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_leads_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_watch_state: {
        Row: {
          charter_folder_id: string | null
          charter_last_checked_at: string | null
          charter_last_synced_at: string | null
          charter_sync_status: string
          contact_id: string
          created_at: string
          id: string
          last_checked_at: string
          last_file_found_at: string | null
          updated_at: string
        }
        Insert: {
          charter_folder_id?: string | null
          charter_last_checked_at?: string | null
          charter_last_synced_at?: string | null
          charter_sync_status?: string
          contact_id: string
          created_at?: string
          id?: string
          last_checked_at?: string
          last_file_found_at?: string | null
          updated_at?: string
        }
        Update: {
          charter_folder_id?: string | null
          charter_last_checked_at?: string | null
          charter_last_synced_at?: string | null
          charter_sync_status?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_checked_at?: string
          last_file_found_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drive_watch_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_digest_queue: {
        Row: {
          contact_id: string | null
          created_at: string
          first_name: string | null
          id: string
          link_tab: string
          recipient_email: string
          sent_at: string | null
          task_event: string
          task_name: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          link_tab?: string
          recipient_email: string
          sent_at?: string | null
          task_event: string
          task_name: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          link_tab?: string
          recipient_email?: string
          sent_at?: string | null
          task_event?: string
          task_name?: string
        }
        Relationships: []
      }
      engagement_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          engagement_id: string
          id: string
          read_by_pro_at: string | null
          read_by_staff_at: string | null
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          engagement_id: string
          id?: string
          read_by_pro_at?: string | null
          read_by_staff_at?: string | null
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          engagement_id?: string
          id?: string
          read_by_pro_at?: string | null
          read_by_staff_at?: string | null
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_messages_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "professional_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          annual_savings: number
          charter_document_url: string | null
          created_at: string
          created_by: string
          fee_tier: Database["public"]["Enums"]["fee_tier"]
          fee_tier_discount_pct: number
          grouped_aum_cad: number | null
          has_ratified_charter: boolean
          id: string
          name: string
          service_tier: Database["public"]["Enums"]["service_tier"] | null
          service_tier_computed_at: string | null
          service_tier_overridden_at: string | null
          service_tier_overridden_by: string | null
          service_tier_source: string
          total_family_assets: number
          updated_at: string
          vfo_enabled: boolean
          vfo_enrolled_at: string | null
        }
        Insert: {
          annual_savings?: number
          charter_document_url?: string | null
          created_at?: string
          created_by: string
          fee_tier?: Database["public"]["Enums"]["fee_tier"]
          fee_tier_discount_pct?: number
          grouped_aum_cad?: number | null
          has_ratified_charter?: boolean
          id?: string
          name: string
          service_tier?: Database["public"]["Enums"]["service_tier"] | null
          service_tier_computed_at?: string | null
          service_tier_overridden_at?: string | null
          service_tier_overridden_by?: string | null
          service_tier_source?: string
          total_family_assets?: number
          updated_at?: string
          vfo_enabled?: boolean
          vfo_enrolled_at?: string | null
        }
        Update: {
          annual_savings?: number
          charter_document_url?: string | null
          created_at?: string
          created_by?: string
          fee_tier?: Database["public"]["Enums"]["fee_tier"]
          fee_tier_discount_pct?: number
          grouped_aum_cad?: number | null
          has_ratified_charter?: boolean
          id?: string
          name?: string
          service_tier?: Database["public"]["Enums"]["service_tier"] | null
          service_tier_computed_at?: string | null
          service_tier_overridden_at?: string | null
          service_tier_overridden_by?: string | null
          service_tier_source?: string
          total_family_assets?: number
          updated_at?: string
          vfo_enabled?: boolean
          vfo_enrolled_at?: string | null
        }
        Relationships: []
      }
      family_relationships: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          member_contact_id: string
          relationship_label: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          member_contact_id: string
          relationship_label?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          member_contact_id?: string
          relationship_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_relationships_member_contact_id_fkey"
            columns: ["member_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      georgia_analytics_sync_configs: {
        Row: {
          created_at: string
          destination_type: string
          id: string
          is_active: boolean
          last_error: string | null
          last_run_status: string | null
          last_synced_at: string | null
          spreadsheet_id: string
          updated_at: string
          worksheet_abandoned_name: string
          worksheet_summary_name: string
          worksheet_traffic_name: string
        }
        Insert: {
          created_at?: string
          destination_type?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_status?: string | null
          last_synced_at?: string | null
          spreadsheet_id: string
          updated_at?: string
          worksheet_abandoned_name?: string
          worksheet_summary_name?: string
          worksheet_traffic_name?: string
        }
        Update: {
          created_at?: string
          destination_type?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_status?: string | null
          last_synced_at?: string | null
          spreadsheet_id?: string
          updated_at?: string
          worksheet_abandoned_name?: string
          worksheet_summary_name?: string
          worksheet_traffic_name?: string
        }
        Relationships: []
      }
      georgia_session_starts: {
        Row: {
          created_at: string
          ended_at: string | null
          final_phase: string
          id: string
          landing_path: string | null
          last_activity_at: string
          lead_captured: boolean
          message_count: number
          reached_lead_capture: boolean
          referrer: string | null
          session_key: string
          source: string
          started_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          final_phase?: string
          id?: string
          landing_path?: string | null
          last_activity_at?: string
          lead_captured?: boolean
          message_count?: number
          reached_lead_capture?: boolean
          referrer?: string | null
          session_key: string
          source?: string
          started_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          final_phase?: string
          id?: string
          landing_path?: string | null
          last_activity_at?: string
          lead_captured?: boolean
          message_count?: number
          reached_lead_capture?: boolean
          referrer?: string | null
          session_key?: string
          source?: string
          started_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      georgia2_leads: {
        Row: {
          answers: Json
          catalyst: string
          chosen_pathway: string
          created_at: string
          domain: string
          email: string
          first_name: string
          id: string
          mobile: string | null
          notes: string | null
          scale: number
          session_key: string | null
          status: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          catalyst: string
          chosen_pathway: string
          created_at?: string
          domain: string
          email: string
          first_name: string
          id?: string
          mobile?: string | null
          notes?: string | null
          scale: number
          session_key?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          catalyst?: string
          chosen_pathway?: string
          created_at?: string
          domain?: string
          email?: string
          first_name?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          scale?: number
          session_key?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "georgia2_leads_session_key_fkey"
            columns: ["session_key"]
            isOneToOne: false
            referencedRelation: "georgia2_sessions"
            referencedColumns: ["session_key"]
          },
        ]
      }
      georgia2_sessions: {
        Row: {
          answers: Json
          catalyst: string | null
          chosen_pathway: string | null
          created_at: string
          domain: string | null
          ended_at: string | null
          final_phase: string | null
          id: string
          last_activity_at: string
          lead_captured: boolean
          message_count: number
          reached_lead_capture: boolean
          referrer: string | null
          scale: number | null
          session_key: string
          source: string | null
          step_catalyst_reached_at: string | null
          step_confidential_reached_at: string | null
          step_diagnostic_reached_at: string | null
          step_domain_reached_at: string | null
          step_pathway_reached_at: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          answers?: Json
          catalyst?: string | null
          chosen_pathway?: string | null
          created_at?: string
          domain?: string | null
          ended_at?: string | null
          final_phase?: string | null
          id?: string
          last_activity_at?: string
          lead_captured?: boolean
          message_count?: number
          reached_lead_capture?: boolean
          referrer?: string | null
          scale?: number | null
          session_key: string
          source?: string | null
          step_catalyst_reached_at?: string | null
          step_confidential_reached_at?: string | null
          step_diagnostic_reached_at?: string | null
          step_domain_reached_at?: string | null
          step_pathway_reached_at?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          answers?: Json
          catalyst?: string | null
          chosen_pathway?: string | null
          created_at?: string
          domain?: string | null
          ended_at?: string | null
          final_phase?: string | null
          id?: string
          last_activity_at?: string
          lead_captured?: boolean
          message_count?: number
          reached_lead_capture?: boolean
          referrer?: string | null
          scale?: number | null
          session_key?: string
          source?: string | null
          step_catalyst_reached_at?: string | null
          step_confidential_reached_at?: string | null
          step_diagnostic_reached_at?: string | null
          step_domain_reached_at?: string | null
          step_pathway_reached_at?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      google_tokens: {
        Row: {
          access_token: string
          created_at: string
          id: string
          refresh_token: string
          scopes: string[]
          token_expiry: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          refresh_token: string
          scopes?: string[]
          token_expiry: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          refresh_token?: string
          scopes?: string[]
          token_expiry?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      governance_alignment_results: {
        Row: {
          advisor_note: string | null
          advisor_override: string | null
          alignment_status: string
          charter_principle: string
          charter_section_key: string | null
          created_at: string
          evidence_source: Json
          exception_reason: string | null
          fact_key: string
          id: string
          performance_fact: Json
          recommended_action: string | null
          review_id: string
          updated_at: string
        }
        Insert: {
          advisor_note?: string | null
          advisor_override?: string | null
          alignment_status?: string
          charter_principle?: string
          charter_section_key?: string | null
          created_at?: string
          evidence_source?: Json
          exception_reason?: string | null
          fact_key: string
          id?: string
          performance_fact?: Json
          recommended_action?: string | null
          review_id: string
          updated_at?: string
        }
        Update: {
          advisor_note?: string | null
          advisor_override?: string | null
          alignment_status?: string
          charter_principle?: string
          charter_section_key?: string | null
          created_at?: string
          evidence_source?: Json
          exception_reason?: string | null
          fact_key?: string
          id?: string
          performance_fact?: Json
          recommended_action?: string | null
          review_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_alignment_results_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "monthly_governance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_audits: {
        Row: {
          computed: Json
          created_at: string
          created_by: string | null
          generated_at: string | null
          generation_error: string | null
          generation_status: string
          household_id: string
          id: string
          is_draft: boolean
          updated_at: string
        }
        Insert: {
          computed?: Json
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          household_id: string
          id?: string
          is_draft?: boolean
          updated_at?: string
        }
        Update: {
          computed?: Json
          created_at?: string
          created_by?: string | null
          generated_at?: string | null
          generation_error?: string | null
          generation_status?: string
          household_id?: string
          id?: string
          is_draft?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_audits_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_review_findings: {
        Row: {
          account_ref: Json
          code: string
          created_at: string
          id: string
          message: string
          resolved_at: string | null
          resolved_by: string | null
          review_id: string
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          account_ref?: Json
          code: string
          created_at?: string
          id?: string
          message: string
          resolved_at?: string | null
          resolved_by?: string | null
          review_id: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_ref?: Json
          code?: string
          created_at?: string
          id?: string
          message?: string
          resolved_at?: string | null
          resolved_by?: string | null
          review_id?: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_review_findings_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "monthly_governance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      holding_tank: {
        Row: {
          account_name: string
          account_number: string | null
          account_owner: string | null
          account_type: string
          beneficiary_designation: string | null
          book_value: number | null
          contact_id: string
          created_at: string
          current_value: number | null
          custodian: string | null
          expected_deposit_date: string | null
          household_id: string | null
          id: string
          notes: string | null
          source_file: string | null
          status: string
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          account_name: string
          account_number?: string | null
          account_owner?: string | null
          account_type?: string
          beneficiary_designation?: string | null
          book_value?: number | null
          contact_id: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          expected_deposit_date?: string | null
          household_id?: string | null
          id?: string
          notes?: string | null
          source_file?: string | null
          status?: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          account_name?: string
          account_number?: string | null
          account_owner?: string | null
          account_type?: string
          beneficiary_designation?: string | null
          book_value?: number | null
          contact_id?: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          expected_deposit_date?: string | null
          household_id?: string | null
          id?: string
          notes?: string | null
          source_file?: string | null
          status?: string
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "holding_tank_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holding_tank_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_charters: {
        Row: {
          active_operational_assets_value: number | null
          boundary_protocol_note: string | null
          capital_request_framework_note: string | null
          cda_balance: number | null
          completed_at: string | null
          completed_by: string | null
          core_values: Json
          corporate_passive_income_annual: number | null
          created_at: string
          created_by: string | null
          discretionary_trust_guidelines: string | null
          governance_snapshot: Json | null
          governance_snapshot_computed_at: string | null
          grounding_principles: Json
          household_id: string
          hub_spoke_cadence_note: string | null
          id: string
          legal_documents: Json
          matrimonial_ringfencing_note: string | null
          meeting_transcripts: Json
          poa_incapacity_protocol: string | null
          pure_fiduciary_standard_note: string | null
          river_boundary_note: string | null
          shareholder_voting_philosophy: string | null
          status: string
          step: number
          tax_friction_shields_note: string | null
          treasury_snapshot: Json | null
          treasury_snapshot_computed_at: string | null
          tri_party_mou_note: string | null
          updated_at: string
          vineyard_replenishment_policy: string | null
          vision_text: string | null
        }
        Insert: {
          active_operational_assets_value?: number | null
          boundary_protocol_note?: string | null
          capital_request_framework_note?: string | null
          cda_balance?: number | null
          completed_at?: string | null
          completed_by?: string | null
          core_values?: Json
          corporate_passive_income_annual?: number | null
          created_at?: string
          created_by?: string | null
          discretionary_trust_guidelines?: string | null
          governance_snapshot?: Json | null
          governance_snapshot_computed_at?: string | null
          grounding_principles?: Json
          household_id: string
          hub_spoke_cadence_note?: string | null
          id?: string
          legal_documents?: Json
          matrimonial_ringfencing_note?: string | null
          meeting_transcripts?: Json
          poa_incapacity_protocol?: string | null
          pure_fiduciary_standard_note?: string | null
          river_boundary_note?: string | null
          shareholder_voting_philosophy?: string | null
          status?: string
          step?: number
          tax_friction_shields_note?: string | null
          treasury_snapshot?: Json | null
          treasury_snapshot_computed_at?: string | null
          tri_party_mou_note?: string | null
          updated_at?: string
          vineyard_replenishment_policy?: string | null
          vision_text?: string | null
        }
        Update: {
          active_operational_assets_value?: number | null
          boundary_protocol_note?: string | null
          capital_request_framework_note?: string | null
          cda_balance?: number | null
          completed_at?: string | null
          completed_by?: string | null
          core_values?: Json
          corporate_passive_income_annual?: number | null
          created_at?: string
          created_by?: string | null
          discretionary_trust_guidelines?: string | null
          governance_snapshot?: Json | null
          governance_snapshot_computed_at?: string | null
          grounding_principles?: Json
          household_id?: string
          hub_spoke_cadence_note?: string | null
          id?: string
          legal_documents?: Json
          matrimonial_ringfencing_note?: string | null
          meeting_transcripts?: Json
          poa_incapacity_protocol?: string | null
          pure_fiduciary_standard_note?: string | null
          river_boundary_note?: string | null
          shareholder_voting_philosophy?: string | null
          status?: string
          step?: number
          tax_friction_shields_note?: string | null
          treasury_snapshot?: Json | null
          treasury_snapshot_computed_at?: string | null
          tri_party_mou_note?: string | null
          updated_at?: string
          vineyard_replenishment_policy?: string | null
          vision_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_charters_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_relationships: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          member_contact_id: string
          relationship_label: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          member_contact_id: string
          relationship_label?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          member_contact_id?: string
          relationship_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_relationships_member_contact_id_fkey"
            columns: ["member_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          address: string | null
          anchor_transfer_amount: number | null
          anchor_transfer_amount_note: string | null
          audit_booked_at: string | null
          created_at: string
          family_id: string
          fiduciary_entity: Database["public"]["Enums"]["fiduciary_entity"]
          governance_status: Database["public"]["Enums"]["governance_status"]
          hof_visible: boolean
          household_context_completed_at: string | null
          id: string
          intake_manifest_url: string | null
          intake_share_token: string | null
          intake_upload_url: string | null
          label: string
          legacy_advisor_friction_notes: string | null
          legacy_intake_upgrade: boolean
          onboarding_completed_at: string | null
          onboarding_enabled: boolean
          onboarding_step: number
          pending_capex_amount: number | null
          pending_capex_date: string | null
          pending_capex_description: string | null
          pressure_note: string | null
          pressure_types: string[] | null
          profile_completed_at: string | null
          purpose_notes: string | null
          quiet_period_start_date: string | null
          relationship_end_reason: string | null
          relationship_ended_at: string | null
          retention_flagged_at: string | null
          spousal_alignment_note: string | null
          spousal_alignment_score: number | null
          updated_at: string
          values_notes: string | null
          vault_root_folder_id: string | null
          vault_shoebox_folder_id: string | null
          vision_notes: string | null
          wealth_event_completed_at: string | null
          wealth_event_notes: string | null
          wealth_event_type: string | null
        }
        Insert: {
          address?: string | null
          anchor_transfer_amount?: number | null
          anchor_transfer_amount_note?: string | null
          audit_booked_at?: string | null
          created_at?: string
          family_id: string
          fiduciary_entity?: Database["public"]["Enums"]["fiduciary_entity"]
          governance_status?: Database["public"]["Enums"]["governance_status"]
          hof_visible?: boolean
          household_context_completed_at?: string | null
          id?: string
          intake_manifest_url?: string | null
          intake_share_token?: string | null
          intake_upload_url?: string | null
          label?: string
          legacy_advisor_friction_notes?: string | null
          legacy_intake_upgrade?: boolean
          onboarding_completed_at?: string | null
          onboarding_enabled?: boolean
          onboarding_step?: number
          pending_capex_amount?: number | null
          pending_capex_date?: string | null
          pending_capex_description?: string | null
          pressure_note?: string | null
          pressure_types?: string[] | null
          profile_completed_at?: string | null
          purpose_notes?: string | null
          quiet_period_start_date?: string | null
          relationship_end_reason?: string | null
          relationship_ended_at?: string | null
          retention_flagged_at?: string | null
          spousal_alignment_note?: string | null
          spousal_alignment_score?: number | null
          updated_at?: string
          values_notes?: string | null
          vault_root_folder_id?: string | null
          vault_shoebox_folder_id?: string | null
          vision_notes?: string | null
          wealth_event_completed_at?: string | null
          wealth_event_notes?: string | null
          wealth_event_type?: string | null
        }
        Update: {
          address?: string | null
          anchor_transfer_amount?: number | null
          anchor_transfer_amount_note?: string | null
          audit_booked_at?: string | null
          created_at?: string
          family_id?: string
          fiduciary_entity?: Database["public"]["Enums"]["fiduciary_entity"]
          governance_status?: Database["public"]["Enums"]["governance_status"]
          hof_visible?: boolean
          household_context_completed_at?: string | null
          id?: string
          intake_manifest_url?: string | null
          intake_share_token?: string | null
          intake_upload_url?: string | null
          label?: string
          legacy_advisor_friction_notes?: string | null
          legacy_intake_upgrade?: boolean
          onboarding_completed_at?: string | null
          onboarding_enabled?: boolean
          onboarding_step?: number
          pending_capex_amount?: number | null
          pending_capex_date?: string | null
          pending_capex_description?: string | null
          pressure_note?: string | null
          pressure_types?: string[] | null
          profile_completed_at?: string | null
          purpose_notes?: string | null
          quiet_period_start_date?: string | null
          relationship_end_reason?: string | null
          relationship_ended_at?: string | null
          retention_flagged_at?: string | null
          spousal_alignment_note?: string | null
          spousal_alignment_score?: number | null
          updated_at?: string
          values_notes?: string | null
          vault_root_folder_id?: string | null
          vault_shoebox_folder_id?: string | null
          vision_notes?: string | null
          wealth_event_completed_at?: string | null
          wealth_event_notes?: string | null
          wealth_event_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "households_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_policies: {
        Row: {
          carrier: string
          cash_value: number | null
          cash_value_storehouse_id: string | null
          contact_id: string | null
          contingent_beneficiary: string | null
          corporation_id: string | null
          coverage_amount: number | null
          coverage_storehouse_id: string | null
          created_at: string
          id: string
          insured_name: string | null
          issue_date: string | null
          notes: string | null
          paid_up_date: string | null
          policy_number: string | null
          policy_type: string
          premium_amount: number | null
          premium_frequency: string | null
          primary_beneficiary: string | null
          renewal_date: string | null
          updated_at: string
          vault_folder_id: string | null
          visibility_scope: string | null
        }
        Insert: {
          carrier: string
          cash_value?: number | null
          cash_value_storehouse_id?: string | null
          contact_id?: string | null
          contingent_beneficiary?: string | null
          corporation_id?: string | null
          coverage_amount?: number | null
          coverage_storehouse_id?: string | null
          created_at?: string
          id?: string
          insured_name?: string | null
          issue_date?: string | null
          notes?: string | null
          paid_up_date?: string | null
          policy_number?: string | null
          policy_type?: string
          premium_amount?: number | null
          premium_frequency?: string | null
          primary_beneficiary?: string | null
          renewal_date?: string | null
          updated_at?: string
          vault_folder_id?: string | null
          visibility_scope?: string | null
        }
        Update: {
          carrier?: string
          cash_value?: number | null
          cash_value_storehouse_id?: string | null
          contact_id?: string | null
          contingent_beneficiary?: string | null
          corporation_id?: string | null
          coverage_amount?: number | null
          coverage_storehouse_id?: string | null
          created_at?: string
          id?: string
          insured_name?: string | null
          issue_date?: string | null
          notes?: string | null
          paid_up_date?: string | null
          policy_number?: string | null
          policy_type?: string
          premium_amount?: number | null
          premium_frequency?: string | null
          primary_beneficiary?: string | null
          renewal_date?: string | null
          updated_at?: string
          vault_folder_id?: string | null
          visibility_scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_policies_cash_value_storehouse_id_fkey"
            columns: ["cash_value_storehouse_id"]
            isOneToOne: false
            referencedRelation: "storehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_coverage_storehouse_id_fkey"
            columns: ["coverage_storehouse_id"]
            isOneToOne: false
            referencedRelation: "storehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_checklist_templates: {
        Row: {
          category: string | null
          created_at: string
          household_type: string | null
          id: string
          is_active: boolean
          name: string
          requirement: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          household_type?: string | null
          id?: string
          is_active?: boolean
          name: string
          requirement?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          household_type?: string | null
          id?: string
          is_active?: boolean
          name?: string
          requirement?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      intake_classifications: {
        Row: {
          confidence: number | null
          created_at: string
          drive_file_id: string | null
          file_name: string
          household_id: string
          id: string
          matched_checklist_template_id: string | null
          mime_type: string | null
          predicted_category: string | null
          review_required: boolean
          size_bytes: number | null
          status: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          drive_file_id?: string | null
          file_name: string
          household_id: string
          id?: string
          matched_checklist_template_id?: string | null
          mime_type?: string | null
          predicted_category?: string | null
          review_required?: boolean
          size_bytes?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          drive_file_id?: string | null
          file_name?: string
          household_id?: string
          id?: string
          matched_checklist_template_id?: string | null
          mime_type?: string | null
          predicted_category?: string | null
          review_required?: boolean
          size_bytes?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_intake_classifications_template"
            columns: ["matched_checklist_template_id"]
            isOneToOne: false
            referencedRelation: "intake_checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_classifications_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total: number
          quantity: number
          service_id: string | null
          sort_order: number
          unit_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total?: number
          quantity?: number
          service_id?: string | null
          sort_order?: number
          unit_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number
          quantity?: number
          service_id?: string | null
          sort_order?: number
          unit_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          invoice_id: string
          paid_at: string
          raw_payload: Json | null
          square_payment_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id: string
          paid_at?: string
          raw_payload?: Json | null
          square_payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string
          paid_at?: string
          raw_payload?: Json | null
          square_payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          ai_prompt: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount_amount: number
          due_date: string | null
          id: string
          invoice_number: string | null
          is_ai_draft: boolean
          issue_date: string
          last_error: string | null
          notes: string | null
          paid_at: string | null
          payment_method: string
          payment_reference: string | null
          pipeline_id: string | null
          public_payment_url: string | null
          review_queue_id: string | null
          sent_at: string | null
          square_invoice_id: string | null
          square_order_id: string | null
          square_version: number | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          updated_at: string
        }
        Insert: {
          ai_prompt?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          is_ai_draft?: boolean
          issue_date?: string
          last_error?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          pipeline_id?: string | null
          public_payment_url?: string | null
          review_queue_id?: string | null
          sent_at?: string | null
          square_invoice_id?: string | null
          square_order_id?: string | null
          square_version?: number | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
        }
        Update: {
          ai_prompt?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          is_ai_draft?: boolean
          issue_date?: string
          last_error?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          pipeline_id?: string | null
          public_payment_url?: string | null
          review_queue_id?: string | null
          sent_at?: string | null
          square_invoice_id?: string | null
          square_order_id?: string | null
          square_version?: number | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "business_pipeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_review_queue_id_fkey"
            columns: ["review_queue_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: string
          content: string
          created_at: string
          created_by: string
          file_path: string | null
          id: string
          is_active: boolean
          source_type: string
          target: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string
          created_by: string
          file_path?: string | null
          id?: string
          is_active?: boolean
          source_type?: string
          target?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          created_by?: string
          file_path?: string | null
          id?: string
          is_active?: boolean
          source_type?: string
          target?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      liabilities: {
        Row: {
          contact_id: string | null
          corporation_id: string | null
          counterparty_contact_id: string | null
          counterparty_corporation_id: string | null
          counterparty_type:
            | Database["public"]["Enums"]["liability_counterparty_type"]
            | null
          created_at: string
          created_by: string
          current_balance: number
          description: string
          due_date: string | null
          holder_type: Database["public"]["Enums"]["liability_holder_type"]
          id: string
          interest_rate_pct: number | null
          last_audit_flagged_at: string | null
          liability_type: Database["public"]["Enums"]["liability_type"]
          notes: string | null
          original_amount: number | null
          origination_date: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          corporation_id?: string | null
          counterparty_contact_id?: string | null
          counterparty_corporation_id?: string | null
          counterparty_type?:
            | Database["public"]["Enums"]["liability_counterparty_type"]
            | null
          created_at?: string
          created_by: string
          current_balance?: number
          description: string
          due_date?: string | null
          holder_type: Database["public"]["Enums"]["liability_holder_type"]
          id?: string
          interest_rate_pct?: number | null
          last_audit_flagged_at?: string | null
          liability_type?: Database["public"]["Enums"]["liability_type"]
          notes?: string | null
          original_amount?: number | null
          origination_date?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          corporation_id?: string | null
          counterparty_contact_id?: string | null
          counterparty_corporation_id?: string | null
          counterparty_type?:
            | Database["public"]["Enums"]["liability_counterparty_type"]
            | null
          created_at?: string
          created_by?: string
          current_balance?: number
          description?: string
          due_date?: string | null
          holder_type?: Database["public"]["Enums"]["liability_holder_type"]
          id?: string
          interest_rate_pct?: number | null
          last_audit_flagged_at?: string | null
          liability_type?: Database["public"]["Enums"]["liability_type"]
          notes?: string | null
          original_amount?: number | null
          origination_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "liabilities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liabilities_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liabilities_counterparty_contact_id_fkey"
            columns: ["counterparty_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liabilities_counterparty_corporation_id_fkey"
            columns: ["counterparty_corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_activity_log: {
        Row: {
          body: string
          contact_id: string
          created_at: string
          direction: Database["public"]["Enums"]["manual_activity_direction"]
          duration_minutes: number | null
          id: string
          kind: Database["public"]["Enums"]["manual_activity_kind"]
          logged_by: string
          occurred_at: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body?: string
          contact_id: string
          created_at?: string
          direction?: Database["public"]["Enums"]["manual_activity_direction"]
          duration_minutes?: number | null
          id?: string
          kind: Database["public"]["Enums"]["manual_activity_kind"]
          logged_by: string
          occurred_at?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          contact_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["manual_activity_direction"]
          duration_minutes?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["manual_activity_kind"]
          logged_by?: string
          occurred_at?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      marketing_update_reads: {
        Row: {
          contact_id: string
          id: string
          read_at: string
          update_id: string
        }
        Insert: {
          contact_id: string
          id?: string
          read_at?: string
          update_id: string
        }
        Update: {
          contact_id?: string
          id?: string
          read_at?: string
          update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_update_reads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_update_reads_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "marketing_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_updates: {
        Row: {
          created_at: string
          id: string
          published_by: string
          scheduled_at: string | null
          sent: boolean
          target_contact_ids: string[] | null
          target_governance_status: string
          target_household_ids: string[] | null
          title: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          published_by: string
          scheduled_at?: string | null
          sent?: boolean
          target_contact_ids?: string[] | null
          target_governance_status?: string
          target_household_ids?: string[] | null
          title: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          published_by?: string
          scheduled_at?: string | null
          sent?: boolean
          target_contact_ids?: string[] | null
          target_governance_status?: string
          target_household_ids?: string[] | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      monthly_governance_reviews: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          briefing_markdown: string | null
          briefing_principal_markdown: string | null
          charter_checked_at: string | null
          counts: Json
          created_at: string
          created_by: string | null
          generation_error: string | null
          id: string
          period_end: string
          scope_id: string
          scope_type: string
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          briefing_markdown?: string | null
          briefing_principal_markdown?: string | null
          charter_checked_at?: string | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          generation_error?: string | null
          id?: string
          period_end: string
          scope_id: string
          scope_type: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          briefing_markdown?: string | null
          briefing_principal_markdown?: string | null
          charter_checked_at?: string | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          generation_error?: string | null
          id?: string
          period_end?: string
          scope_id?: string
          scope_type?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      pm_ai_teammate_runs: {
        Row: {
          agent_key: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          requested_by: string
          result_comment_id: string | null
          result_subtask_id: string | null
          status: string
          task_id: string
        }
        Insert: {
          agent_key: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          requested_by: string
          result_comment_id?: string | null
          result_subtask_id?: string | null
          status?: string
          task_id: string
        }
        Update: {
          agent_key?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          requested_by?: string
          result_comment_id?: string | null
          result_subtask_id?: string | null
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_ai_teammate_runs_result_comment_id_fkey"
            columns: ["result_comment_id"]
            isOneToOne: false
            referencedRelation: "pm_task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_ai_teammate_runs_result_subtask_id_fkey"
            columns: ["result_subtask_id"]
            isOneToOne: false
            referencedRelation: "pm_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_ai_teammate_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pm_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_projects: {
        Row: {
          contact_id: string | null
          corporation_id: string | null
          created_at: string
          created_by: string
          description: string | null
          family_id: string | null
          household_id: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          family_id?: string | null
          household_id?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          family_id?: string | null
          household_id?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_projects_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_projects_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_projects_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_projects_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_task_collaborators: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          professional_id: string | null
          tagged_by: string | null
          task_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          professional_id?: string | null
          tagged_by?: string | null
          task_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          professional_id?: string | null
          tagged_by?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_task_collaborators_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_task_collaborators_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pm_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_task_comments: {
        Row: {
          author_agent_key: string | null
          author_contact_id: string | null
          author_id: string | null
          author_professional_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_agent_key?: string | null
          author_contact_id?: string | null
          author_id?: string | null
          author_professional_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_agent_key?: string | null
          author_contact_id?: string | null
          author_id?: string | null
          author_professional_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_task_comments_author_contact_id_fkey"
            columns: ["author_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_task_comments_author_professional_id_fkey"
            columns: ["author_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "pm_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pm_tasks: {
        Row: {
          asana_gid: string | null
          assigned_agent_key: string | null
          assignee_id: string | null
          client_visible: boolean
          completed_at: string | null
          contact_id: string | null
          corporation_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          family_id: string | null
          household_id: string | null
          id: string
          parent_task_id: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          asana_gid?: string | null
          assigned_agent_key?: string | null
          assignee_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          family_id?: string | null
          household_id?: string | null
          id?: string
          parent_task_id?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          asana_gid?: string | null
          assigned_agent_key?: string | null
          assignee_id?: string | null
          client_visible?: boolean
          completed_at?: string | null
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          family_id?: string | null
          household_id?: string | null
          id?: string
          parent_task_id?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pm_tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_tasks_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_tasks_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_tasks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "pm_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pm_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "pm_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_client_notifications: {
        Row: {
          body: string | null
          contact_id: string
          created_at: string
          id: string
          link_tab: string | null
          read: boolean
          source_type: string
          title: string
        }
        Insert: {
          body?: string | null
          contact_id: string
          created_at?: string
          id?: string
          link_tab?: string | null
          read?: boolean
          source_type?: string
          title: string
        }
        Update: {
          body?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          link_tab?: string | null
          read?: boolean
          source_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_client_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_links: {
        Row: {
          created_at: string
          created_by: string
          group_label: string | null
          icon: string
          id: string
          is_active: boolean
          is_system: boolean
          label: string
          link_type: string
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by: string
          group_label?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          label: string
          link_type?: string
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string
          group_label?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          label?: string
          link_type?: string
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      portal_logins: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          login_method: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          login_method?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          login_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_logins_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_otps: {
        Row: {
          code: string
          contact_id: string
          created_at: string
          email: string
          expires_at: string
          failed_attempts: number
          id: string
          verified: boolean
        }
        Insert: {
          code: string
          contact_id: string
          created_at?: string
          email: string
          expires_at: string
          failed_attempts?: number
          id?: string
          verified?: boolean
        }
        Update: {
          code?: string
          contact_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "portal_otps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_request_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          request_id: string
          sender_name: string | null
          sender_type: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          request_id: string
          sender_name?: string | null
          sender_type: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          request_id?: string
          sender_name?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "portal_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_requests: {
        Row: {
          contact_id: string
          created_at: string
          file_urls: string[] | null
          id: string
          request_description: string
          request_details: Json | null
          request_type: string
          resolved_at: string | null
          resolved_by: string | null
          staff_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          file_urls?: string[] | null
          id?: string
          request_description: string
          request_details?: Json | null
          request_type: string
          resolved_at?: string | null
          resolved_by?: string | null
          staff_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          file_urls?: string[] | null
          id?: string
          request_description?: string
          request_details?: Json | null
          request_type?: string
          resolved_at?: string | null
          resolved_by?: string | null
          staff_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_task_interactions: {
        Row: {
          contact_id: string
          id: string
          interacted_at: string
          task_gid: string
        }
        Insert: {
          contact_id: string
          id?: string
          interacted_at?: string
          task_gid: string
        }
        Update: {
          contact_id?: string
          id?: string
          interacted_at?: string
          task_gid?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_task_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tokens: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string
          expires_at: string
          first_used_ip: string | null
          first_used_user_agent: string | null
          id: string
          purpose: string
          revoked: boolean
          single_use: boolean
          target_hash: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by: string
          expires_at?: string
          first_used_ip?: string | null
          first_used_user_agent?: string | null
          id?: string
          purpose?: string
          revoked?: boolean
          single_use?: boolean
          target_hash?: string | null
          token?: string
          used_at?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          first_used_ip?: string | null
          first_used_user_agent?: string | null
          id?: string
          purpose?: string
          revoked?: boolean
          single_use?: boolean
          target_hash?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_tokens_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_trusted_devices: {
        Row: {
          contact_id: string
          created_at: string
          device_label: string | null
          expires_at: string
          id: string
          last_used_at: string | null
          last_used_ip: string | null
          revoked: boolean
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          device_label?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string | null
          last_used_ip?: string | null
          revoked?: boolean
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          device_label?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string | null
          last_used_ip?: string | null
          revoked?: boolean
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_trusted_devices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      pro_portal_tokens: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          id: string
          last_used_at: string | null
          otp_code_hash: string | null
          otp_expires_at: string | null
          professional_id: string
          session_expires_at: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          id?: string
          last_used_at?: string | null
          otp_code_hash?: string | null
          otp_expires_at?: string | null
          professional_id: string
          session_expires_at: string
          token_hash: string
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          id?: string
          last_used_at?: string | null
          otp_code_hash?: string | null
          otp_expires_at?: string | null
          professional_id?: string
          session_expires_at?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "pro_portal_tokens_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_engagements: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          pillar: string
          professional_id: string
          scope_id: string
          scope_type: string
          started_at: string | null
          status: string
          title: string
          updated_at: string
          vault_share_link_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          pillar: string
          professional_id: string
          scope_id: string
          scope_type: string
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
          vault_share_link_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          pillar?: string
          professional_id?: string
          scope_id?: string
          scope_type?: string
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          vault_share_link_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_engagements_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_engagements_vault_share_link_id_fkey"
            columns: ["vault_share_link_id"]
            isOneToOne: false
            referencedRelation: "vault_share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          credentials: string | null
          email: string
          firm: string | null
          full_name: string
          id: string
          last_login_at: string | null
          phone: string | null
          pro_portal_enabled: boolean
          professional_type: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          credentials?: string | null
          email: string
          firm?: string | null
          full_name: string
          id?: string
          last_login_at?: string | null
          phone?: string | null
          pro_portal_enabled?: boolean
          professional_type: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          credentials?: string | null
          email?: string
          firm?: string | null
          full_name?: string
          id?: string
          last_login_at?: string | null
          phone?: string | null
          pro_portal_enabled?: boolean
          professional_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quarterly_system_reviews: {
        Row: {
          alignment_overview: string
          charter_detail: string
          charter_status: string
          client_first_name: string
          client_last_name: string
          contact_id: string
          created_at: string
          created_by: string | null
          cross_system_detail: string
          cross_system_status: string
          footer_note: string
          gap_1: string
          gap_2: string
          gap_3: string
          gap_4: string
          gap_5: string
          generation_error: string | null
          generation_status: string
          id: string
          logic_trace: string | null
          long_term_vision: string
          primary_goal: string
          priority_1: string
          priority_2: string
          priority_3: string
          priority_4: string
          priority_5: string
          purpose_statement: string
          review_date: string | null
          review_summary: string
          storehouse_detail: string
          storehouse_status: string
          updated_at: string
          vineyard_detail: string
          vineyard_status: string
        }
        Insert: {
          alignment_overview?: string
          charter_detail?: string
          charter_status?: string
          client_first_name?: string
          client_last_name?: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          cross_system_detail?: string
          cross_system_status?: string
          footer_note?: string
          gap_1?: string
          gap_2?: string
          gap_3?: string
          gap_4?: string
          gap_5?: string
          generation_error?: string | null
          generation_status?: string
          id?: string
          logic_trace?: string | null
          long_term_vision?: string
          primary_goal?: string
          priority_1?: string
          priority_2?: string
          priority_3?: string
          priority_4?: string
          priority_5?: string
          purpose_statement?: string
          review_date?: string | null
          review_summary?: string
          storehouse_detail?: string
          storehouse_status?: string
          updated_at?: string
          vineyard_detail?: string
          vineyard_status?: string
        }
        Update: {
          alignment_overview?: string
          charter_detail?: string
          charter_status?: string
          client_first_name?: string
          client_last_name?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          cross_system_detail?: string
          cross_system_status?: string
          footer_note?: string
          gap_1?: string
          gap_2?: string
          gap_3?: string
          gap_4?: string
          gap_5?: string
          generation_error?: string | null
          generation_status?: string
          id?: string
          logic_trace?: string | null
          long_term_vision?: string
          primary_goal?: string
          priority_1?: string
          priority_2?: string
          priority_3?: string
          priority_4?: string
          priority_5?: string
          purpose_statement?: string
          review_date?: string | null
          review_summary?: string
          storehouse_detail?: string
          storehouse_status?: string
          updated_at?: string
          vineyard_detail?: string
          vineyard_status?: string
        }
        Relationships: []
      }
      quo_activity_links: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          linked_by: string
          note: string | null
          quo_call_id: string | null
          quo_message_id: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          linked_by: string
          note?: string | null
          quo_call_id?: string | null
          quo_message_id?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          linked_by?: string
          note?: string | null
          quo_call_id?: string | null
          quo_message_id?: string | null
        }
        Relationships: []
      }
      quo_calls: {
        Row: {
          contact_id: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          from_number: string
          id: string
          is_voicemail: boolean
          next_steps: string | null
          occurred_at: string
          portal_visible: boolean
          quo_call_id: string | null
          quo_user_id: string | null
          read_at: string | null
          recording_url: string | null
          status: string
          summary: string | null
          to_number: string
          transcript: string | null
          updated_at: string
          voicemail_url: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number | null
          from_number: string
          id?: string
          is_voicemail?: boolean
          next_steps?: string | null
          occurred_at?: string
          portal_visible?: boolean
          quo_call_id?: string | null
          quo_user_id?: string | null
          read_at?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number: string
          transcript?: string | null
          updated_at?: string
          voicemail_url?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          from_number?: string
          id?: string
          is_voicemail?: boolean
          next_steps?: string | null
          occurred_at?: string
          portal_visible?: boolean
          quo_call_id?: string | null
          quo_user_id?: string | null
          read_at?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number?: string
          transcript?: string | null
          updated_at?: string
          voicemail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quo_calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_contact_sync: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          last_synced_at: string
          quo_contact_id: string
          sync_direction: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          last_synced_at?: string
          quo_contact_id: string
          sync_direction?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string
          quo_contact_id?: string
          sync_direction?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quo_contact_sync_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_inbox_archive: {
        Row: {
          archived_at: string
          archived_by: string | null
          contact_id: string | null
          id: string
          last_message_at: string | null
          phone_digits: string | null
          thread_key: string
        }
        Insert: {
          archived_at?: string
          archived_by?: string | null
          contact_id?: string | null
          id?: string
          last_message_at?: string | null
          phone_digits?: string | null
          thread_key: string
        }
        Update: {
          archived_at?: string
          archived_by?: string | null
          contact_id?: string | null
          id?: string
          last_message_at?: string | null
          phone_digits?: string | null
          thread_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "quo_inbox_archive_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_messages: {
        Row: {
          body: string
          contact_id: string | null
          created_at: string
          direction: string
          from_number: string
          id: string
          media_urls: string[] | null
          occurred_at: string
          pii_block_reason: string | null
          pii_blocked: boolean
          portal_visible: boolean
          quo_message_id: string | null
          quo_user_id: string | null
          read_at: string | null
          sent_by: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          body?: string
          contact_id?: string | null
          created_at?: string
          direction: string
          from_number: string
          id?: string
          media_urls?: string[] | null
          occurred_at?: string
          pii_block_reason?: string | null
          pii_blocked?: boolean
          portal_visible?: boolean
          quo_message_id?: string | null
          quo_user_id?: string | null
          read_at?: string | null
          sent_by?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          body?: string
          contact_id?: string | null
          created_at?: string
          direction?: string
          from_number?: string
          id?: string
          media_urls?: string[] | null
          occurred_at?: string
          pii_block_reason?: string | null
          pii_blocked?: boolean
          portal_visible?: boolean
          quo_message_id?: string | null
          quo_user_id?: string | null
          read_at?: string | null
          sent_by?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quo_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      quo_webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed: boolean
          processing_error: string | null
          quo_event_id: string | null
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          event_type: string
          id?: string
          payload?: Json
          processed?: boolean
          processing_error?: string | null
          quo_event_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
          processing_error?: string | null
          quo_event_id?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: []
      }
      review_queue: {
        Row: {
          action_description: string
          action_type: string
          client_visible: boolean
          contact_id: string | null
          created_at: string
          created_by: string | null
          escalated_to: string | null
          family_id: string | null
          id: string
          logic_trace: string | null
          proposed_data: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
        }
        Insert: {
          action_description: string
          action_type: string
          client_visible?: boolean
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          escalated_to?: string | null
          family_id?: string | null
          id?: string
          logic_trace?: string | null
          proposed_data?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Update: {
          action_description?: string
          action_type?: string
          client_visible?: boolean
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          escalated_to?: string | null
          family_id?: string | null
          id?: string
          logic_trace?: string | null
          proposed_data?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_queue_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_logs: {
        Row: {
          created_at: string
          id: string
          logic_trace: string
          run_id: string
          status: string
          test_name: string
        }
        Insert: {
          created_at?: string
          id?: string
          logic_trace: string
          run_id: string
          status: string
          test_name: string
        }
        Update: {
          created_at?: string
          id?: string
          logic_trace?: string
          run_id?: string
          status?: string
          test_name?: string
        }
        Relationships: []
      }
      service_bookings: {
        Row: {
          amount: number | null
          checkout_url: string | null
          contact_id: string | null
          created_at: string
          currency: string | null
          duration_minutes: number | null
          id: string
          invoice_id: string | null
          notes: string | null
          paid_at: string | null
          payment_status: string
          requester_email: string | null
          requester_name: string | null
          requester_phone: string | null
          scheduling_url: string | null
          service_id: string | null
          square_order_id: string | null
          square_payment_id: string | null
          square_payment_link_id: string | null
          starts_at: string | null
          status: string
          tax_amount: number | null
          total: number | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          checkout_url?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          duration_minutes?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          requester_email?: string | null
          requester_name?: string | null
          requester_phone?: string | null
          scheduling_url?: string | null
          service_id?: string | null
          square_order_id?: string | null
          square_payment_id?: string | null
          square_payment_link_id?: string | null
          starts_at?: string | null
          status?: string
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          checkout_url?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          duration_minutes?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          requester_email?: string | null
          requester_name?: string | null
          requester_phone?: string | null
          scheduling_url?: string | null
          service_id?: string | null
          square_order_id?: string | null
          square_payment_id?: string | null
          square_payment_link_id?: string | null
          starts_at?: string | null
          status?: string
          tax_amount?: number | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_bookings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_bookings_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          booking_url: string | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean
          name: string
          price: number
          requires_prepayment: boolean
          slug: string | null
          square_catalog_object_id: string | null
          square_sync_error: string | null
          square_sync_status: string
          square_synced_at: string | null
          square_variation_id: string | null
          tax_rate: number
          triggers_onboarding: boolean
          updated_at: string
        }
        Insert: {
          booking_url?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          requires_prepayment?: boolean
          slug?: string | null
          square_catalog_object_id?: string | null
          square_sync_error?: string | null
          square_sync_status?: string
          square_synced_at?: string | null
          square_variation_id?: string | null
          tax_rate?: number
          triggers_onboarding?: boolean
          updated_at?: string
        }
        Update: {
          booking_url?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          requires_prepayment?: boolean
          slug?: string | null
          square_catalog_object_id?: string | null
          square_sync_error?: string | null
          square_sync_status?: string
          square_synced_at?: string | null
          square_variation_id?: string | null
          tax_rate?: number
          triggers_onboarding?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      shareholders: {
        Row: {
          contact_id: string
          corporation_id: string
          created_at: string
          id: string
          is_active: boolean
          ownership_percentage: number
          role_title: string | null
          share_class: string | null
          updated_at: string
        }
        Insert: {
          contact_id: string
          corporation_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          ownership_percentage?: number
          role_title?: string | null
          share_class?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string
          corporation_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          ownership_percentage?: number
          role_title?: string | null
          share_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shareholders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shareholders_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
        ]
      }
      sovereignty_audit_trail: {
        Row: {
          action_description: string
          action_type: string
          approved_at: string
          contact_id: string
          created_at: string
          id: string
          proposed_data: Json | null
          user_id: string
        }
        Insert: {
          action_description: string
          action_type: string
          approved_at?: string
          contact_id: string
          created_at?: string
          id?: string
          proposed_data?: Json | null
          user_id: string
        }
        Update: {
          action_description?: string
          action_type?: string
          approved_at?: string
          contact_id?: string
          created_at?: string
          id?: string
          proposed_data?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sovereignty_audit_trail_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      sovereignty_charter_sources: {
        Row: {
          charter_id: string | null
          contact_id: string
          content_text: string | null
          created_at: string
          created_by: string
          external_file_id: string | null
          external_folder_id: string | null
          external_modified_at: string | null
          extracted_text: string | null
          file_name: string | null
          id: string
          import_origin: string
          input_mode: string
          mime_type: string | null
          sort_order: number
          source_kind: string
          source_url: string | null
          storage_bucket: string | null
          storage_path: string | null
          sync_error: string | null
          title: string
          updated_at: string
        }
        Insert: {
          charter_id?: string | null
          contact_id: string
          content_text?: string | null
          created_at?: string
          created_by: string
          external_file_id?: string | null
          external_folder_id?: string | null
          external_modified_at?: string | null
          extracted_text?: string | null
          file_name?: string | null
          id?: string
          import_origin?: string
          input_mode?: string
          mime_type?: string | null
          sort_order?: number
          source_kind: string
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          sync_error?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          charter_id?: string | null
          contact_id?: string
          content_text?: string | null
          created_at?: string
          created_by?: string
          external_file_id?: string | null
          external_folder_id?: string | null
          external_modified_at?: string | null
          extracted_text?: string | null
          file_name?: string | null
          id?: string
          import_origin?: string
          input_mode?: string
          mime_type?: string | null
          sort_order?: number
          source_kind?: string
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          sync_error?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sovereignty_charter_sources_charter_id_fkey"
            columns: ["charter_id"]
            isOneToOne: false
            referencedRelation: "sovereignty_charters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sovereignty_charter_sources_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      sovereignty_charters: {
        Row: {
          appendix_note: string | null
          architecture_intro: string | null
          conflict_resolution: string | null
          contact_id: string
          created_at: string
          custom_sections: Json
          draft_status: string
          esign_doc_id: string | null
          esign_doc_url: string | null
          esign_error: string | null
          esign_initiated_by: string | null
          esign_last_checked_at: string | null
          esign_sent_at: string | null
          esign_signed_at: string | null
          esign_signed_pdf_path: string | null
          esign_status: string
          executor_alternate: string | null
          executor_primary: string | null
          fiduciary_alliance: string | null
          footer_date_label: string | null
          footer_status: string | null
          full_markdown: string | null
          generation_summary: string | null
          governance_authority: string | null
          growth_primary_detail: string | null
          growth_primary_label: string | null
          growth_primary_value: number | null
          growth_secondary_detail: string | null
          growth_secondary_label: string | null
          growth_secondary_value: number | null
          harvest_accounts_note: string | null
          harvest_review_date: string | null
          harvest_spending_categories: string | null
          harvest_target_income: number | null
          harvest_yield_protocol: string | null
          id: string
          intro_callout: string | null
          intro_heading: string | null
          intro_note: string | null
          last_generated_at: string | null
          long_term_strategy: string | null
          mission_of_capital: string | null
          monitoring_cadence: string | null
          primary_goal: string | null
          professional_coordination: string | null
          protected_assets_note: string | null
          quiet_period: string | null
          ratification_signatories: Json
          ratified_at: string | null
          ratified_by: string | null
          roles_responsibilities: string | null
          secondary_quiet_period_rule: string | null
          storehouse_legacy_detail: string | null
          storehouse_liquidity_detail: string | null
          storehouse_liquidity_value: number | null
          storehouse_philanthropic_detail: string | null
          storehouse_strategic_detail: string | null
          storehouse_strategic_value: number | null
          subtitle: string | null
          succession_terms: string | null
          title: string | null
          transition_summary: string | null
          updated_at: string
          vision_20_year: string | null
          withdrawal_safeguards: string | null
        }
        Insert: {
          appendix_note?: string | null
          architecture_intro?: string | null
          conflict_resolution?: string | null
          contact_id: string
          created_at?: string
          custom_sections?: Json
          draft_status?: string
          esign_doc_id?: string | null
          esign_doc_url?: string | null
          esign_error?: string | null
          esign_initiated_by?: string | null
          esign_last_checked_at?: string | null
          esign_sent_at?: string | null
          esign_signed_at?: string | null
          esign_signed_pdf_path?: string | null
          esign_status?: string
          executor_alternate?: string | null
          executor_primary?: string | null
          fiduciary_alliance?: string | null
          footer_date_label?: string | null
          footer_status?: string | null
          full_markdown?: string | null
          generation_summary?: string | null
          governance_authority?: string | null
          growth_primary_detail?: string | null
          growth_primary_label?: string | null
          growth_primary_value?: number | null
          growth_secondary_detail?: string | null
          growth_secondary_label?: string | null
          growth_secondary_value?: number | null
          harvest_accounts_note?: string | null
          harvest_review_date?: string | null
          harvest_spending_categories?: string | null
          harvest_target_income?: number | null
          harvest_yield_protocol?: string | null
          id?: string
          intro_callout?: string | null
          intro_heading?: string | null
          intro_note?: string | null
          last_generated_at?: string | null
          long_term_strategy?: string | null
          mission_of_capital?: string | null
          monitoring_cadence?: string | null
          primary_goal?: string | null
          professional_coordination?: string | null
          protected_assets_note?: string | null
          quiet_period?: string | null
          ratification_signatories?: Json
          ratified_at?: string | null
          ratified_by?: string | null
          roles_responsibilities?: string | null
          secondary_quiet_period_rule?: string | null
          storehouse_legacy_detail?: string | null
          storehouse_liquidity_detail?: string | null
          storehouse_liquidity_value?: number | null
          storehouse_philanthropic_detail?: string | null
          storehouse_strategic_detail?: string | null
          storehouse_strategic_value?: number | null
          subtitle?: string | null
          succession_terms?: string | null
          title?: string | null
          transition_summary?: string | null
          updated_at?: string
          vision_20_year?: string | null
          withdrawal_safeguards?: string | null
        }
        Update: {
          appendix_note?: string | null
          architecture_intro?: string | null
          conflict_resolution?: string | null
          contact_id?: string
          created_at?: string
          custom_sections?: Json
          draft_status?: string
          esign_doc_id?: string | null
          esign_doc_url?: string | null
          esign_error?: string | null
          esign_initiated_by?: string | null
          esign_last_checked_at?: string | null
          esign_sent_at?: string | null
          esign_signed_at?: string | null
          esign_signed_pdf_path?: string | null
          esign_status?: string
          executor_alternate?: string | null
          executor_primary?: string | null
          fiduciary_alliance?: string | null
          footer_date_label?: string | null
          footer_status?: string | null
          full_markdown?: string | null
          generation_summary?: string | null
          governance_authority?: string | null
          growth_primary_detail?: string | null
          growth_primary_label?: string | null
          growth_primary_value?: number | null
          growth_secondary_detail?: string | null
          growth_secondary_label?: string | null
          growth_secondary_value?: number | null
          harvest_accounts_note?: string | null
          harvest_review_date?: string | null
          harvest_spending_categories?: string | null
          harvest_target_income?: number | null
          harvest_yield_protocol?: string | null
          id?: string
          intro_callout?: string | null
          intro_heading?: string | null
          intro_note?: string | null
          last_generated_at?: string | null
          long_term_strategy?: string | null
          mission_of_capital?: string | null
          monitoring_cadence?: string | null
          primary_goal?: string | null
          professional_coordination?: string | null
          protected_assets_note?: string | null
          quiet_period?: string | null
          ratification_signatories?: Json
          ratified_at?: string | null
          ratified_by?: string | null
          roles_responsibilities?: string | null
          secondary_quiet_period_rule?: string | null
          storehouse_legacy_detail?: string | null
          storehouse_liquidity_detail?: string | null
          storehouse_liquidity_value?: number | null
          storehouse_philanthropic_detail?: string | null
          storehouse_strategic_detail?: string | null
          storehouse_strategic_value?: number | null
          subtitle?: string | null
          succession_terms?: string | null
          title?: string | null
          transition_summary?: string | null
          updated_at?: string
          vision_20_year?: string | null
          withdrawal_safeguards?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sovereignty_charters_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      stabilization_maps: {
        Row: {
          action_plan: Json
          client_first_name: string
          client_last_name: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          diagnostic_inputs: Json
          diagnostics: Json
          event_context: string
          event_type: string
          footer_note: string
          generation_error: string | null
          generation_status: string
          household_id: string | null
          id: string
          lead_id: string | null
          logic_trace: string | null
          next_step_1: string
          next_step_2: string
          next_step_3: string
          next_step_4: string
          next_step_5: string
          risk_1: string
          risk_2: string
          risk_3: string
          risk_4: string
          risk_5: string
          session_date: string | null
          situation_summary: string
          solicitation_detail: string
          solicitation_status: string
          sovereignty_charter_detail: string
          sovereignty_charter_status: string
          storehouse_detail: string
          storehouse_status: string
          tax_detail: string
          tax_status: string
          track_type: string
          updated_at: string
          urgency_flag: string
        }
        Insert: {
          action_plan?: Json
          client_first_name?: string
          client_last_name?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_inputs?: Json
          diagnostics?: Json
          event_context?: string
          event_type?: string
          footer_note?: string
          generation_error?: string | null
          generation_status?: string
          household_id?: string | null
          id?: string
          lead_id?: string | null
          logic_trace?: string | null
          next_step_1?: string
          next_step_2?: string
          next_step_3?: string
          next_step_4?: string
          next_step_5?: string
          risk_1?: string
          risk_2?: string
          risk_3?: string
          risk_4?: string
          risk_5?: string
          session_date?: string | null
          situation_summary?: string
          solicitation_detail?: string
          solicitation_status?: string
          sovereignty_charter_detail?: string
          sovereignty_charter_status?: string
          storehouse_detail?: string
          storehouse_status?: string
          tax_detail?: string
          tax_status?: string
          track_type?: string
          updated_at?: string
          urgency_flag?: string
        }
        Update: {
          action_plan?: Json
          client_first_name?: string
          client_last_name?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_inputs?: Json
          diagnostics?: Json
          event_context?: string
          event_type?: string
          footer_note?: string
          generation_error?: string | null
          generation_status?: string
          household_id?: string | null
          id?: string
          lead_id?: string | null
          logic_trace?: string | null
          next_step_1?: string
          next_step_2?: string
          next_step_3?: string
          next_step_4?: string
          next_step_5?: string
          risk_1?: string
          risk_2?: string
          risk_3?: string
          risk_4?: string
          risk_5?: string
          session_date?: string | null
          situation_summary?: string
          solicitation_detail?: string
          solicitation_status?: string
          sovereignty_charter_detail?: string
          sovereignty_charter_status?: string
          storehouse_detail?: string
          storehouse_status?: string
          tax_detail?: string
          tax_status?: string
          track_type?: string
          updated_at?: string
          urgency_flag?: string
        }
        Relationships: [
          {
            foreignKeyName: "stabilization_maps_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stabilization_maps_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stabilization_maps_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "discovery_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notifications: {
        Row: {
          body: string | null
          contact_id: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          source_type: string
          title: string
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          source_type?: string
          title: string
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          source_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      storehouse_rules: {
        Row: {
          created_at: string
          family_id: string
          id: string
          rule_description: string
          rule_metadata: Json | null
          rule_type: string
          rule_value: number | null
          storehouse_label: string
          storehouse_number: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          rule_description: string
          rule_metadata?: Json | null
          rule_type: string
          rule_value?: number | null
          storehouse_label: string
          storehouse_number: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          rule_description?: string
          rule_metadata?: Json | null
          rule_type?: string
          rule_value?: number | null
          storehouse_label?: string
          storehouse_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storehouse_rules_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      storehouses: {
        Row: {
          account_number: string | null
          asset_type: string | null
          beneficiary_designation: string | null
          book_value: number | null
          charter_alignment: Database["public"]["Enums"]["charter_alignment"]
          contact_id: string | null
          corporation_id: string | null
          created_at: string
          current_value: number | null
          custodian: string | null
          id: string
          label: string
          notes: string | null
          risk_cap: string | null
          storehouse_number: number
          target_value: number | null
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          account_number?: string | null
          asset_type?: string | null
          beneficiary_designation?: string | null
          book_value?: number | null
          charter_alignment?: Database["public"]["Enums"]["charter_alignment"]
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          label?: string
          notes?: string | null
          risk_cap?: string | null
          storehouse_number: number
          target_value?: number | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          account_number?: string | null
          asset_type?: string | null
          beneficiary_designation?: string | null
          book_value?: number | null
          charter_alignment?: Database["public"]["Enums"]["charter_alignment"]
          contact_id?: string | null
          corporation_id?: string | null
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          label?: string
          notes?: string | null
          risk_cap?: string | null
          storehouse_number?: number
          target_value?: number | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "storehouses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storehouses_corporation_id_fkey"
            columns: ["corporation_id"]
            isOneToOne: false
            referencedRelation: "corporations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collaborators: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          professional_id: string | null
          tagged_by: string
          task_gid: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          professional_id?: string | null
          tagged_by: string
          task_gid: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          professional_id?: string | null
          tagged_by?: string
          task_gid?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_collaborators_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      toe_acceptances: {
        Row: {
          accepted_at: string
          created_at: string
          email: string
          full_name: string
          id: string
          pay_slug: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          pay_slug: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          pay_slug?: string
        }
        Relationships: []
      }
      vault_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          actor_type: string
          contact_id: string | null
          created_at: string
          drive_id: string | null
          drive_name: string | null
          household_id: string | null
          id: string
          ip: string | null
          metadata: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          actor_type: string
          contact_id?: string | null
          created_at?: string
          drive_id?: string | null
          drive_name?: string | null
          household_id?: string | null
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          actor_type?: string
          contact_id?: string | null
          created_at?: string
          drive_id?: string | null
          drive_name?: string | null
          household_id?: string | null
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
        }
        Relationships: []
      }
      vault_collaborator_grants: {
        Row: {
          collaborator_id: string
          created_at: string
          drive_id: string
          expires_at: string
          granted_at: string
          granted_by: string | null
          id: string
          permission: string
          revoked_at: string | null
          scope_type: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          drive_id: string
          expires_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission?: string
          revoked_at?: string | null
          scope_type: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          drive_id?: string
          expires_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          permission?: string
          revoked_at?: string | null
          scope_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_collaborator_grants_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "vault_collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_collaborators: {
        Row: {
          contact_id: string | null
          created_at: string
          email: string
          full_name: string
          household_id: string | null
          id: string
          invited_at: string
          invited_by: string | null
          professional_id: string | null
          revoked_at: string | null
          role: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          email: string
          full_name: string
          household_id?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          professional_id?: string | null
          revoked_at?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          household_id?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          professional_id?: string | null
          revoked_at?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_collaborators_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_contact_grants: {
        Row: {
          contact_id: string
          drive_id: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          household_id: string
          id: string
          permission: string
          revoked_at: string | null
          scope_type: string
        }
        Insert: {
          contact_id: string
          drive_id: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          household_id: string
          id?: string
          permission?: string
          revoked_at?: string | null
          scope_type: string
        }
        Update: {
          contact_id?: string
          drive_id?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          household_id?: string
          id?: string
          permission?: string
          revoked_at?: string | null
          scope_type?: string
        }
        Relationships: []
      }
      vault_contact_roles: {
        Row: {
          contact_id: string
          created_at: string
          granted_by: string | null
          household_id: string
          id: string
          role: Database["public"]["Enums"]["vault_contact_role"]
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          granted_by?: string | null
          household_id: string
          id?: string
          role?: Database["public"]["Enums"]["vault_contact_role"]
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          granted_by?: string | null
          household_id?: string
          id?: string
          role?: Database["public"]["Enums"]["vault_contact_role"]
          updated_at?: string
        }
        Relationships: []
      }
      vault_files: {
        Row: {
          ancestor_folder_ids: string[]
          client_visible: boolean
          contact_id: string
          created_at: string
          drive_id: string
          household_id: string | null
          is_folder: boolean
          mime_type: string
          modified_at: string | null
          name: string
          parent_folder_id: string | null
          size_bytes: number | null
          staff_reviewed: boolean
          updated_at: string
          uploaded_by_collaborator_id: string | null
          uploaded_by_contact_id: string | null
        }
        Insert: {
          ancestor_folder_ids?: string[]
          client_visible?: boolean
          contact_id: string
          created_at?: string
          drive_id: string
          household_id?: string | null
          is_folder?: boolean
          mime_type: string
          modified_at?: string | null
          name: string
          parent_folder_id?: string | null
          size_bytes?: number | null
          staff_reviewed?: boolean
          updated_at?: string
          uploaded_by_collaborator_id?: string | null
          uploaded_by_contact_id?: string | null
        }
        Update: {
          ancestor_folder_ids?: string[]
          client_visible?: boolean
          contact_id?: string
          created_at?: string
          drive_id?: string
          household_id?: string | null
          is_folder?: boolean
          mime_type?: string
          modified_at?: string | null
          name?: string
          parent_folder_id?: string | null
          size_bytes?: number | null
          staff_reviewed?: boolean
          updated_at?: string
          uploaded_by_collaborator_id?: string | null
          uploaded_by_contact_id?: string | null
        }
        Relationships: []
      }
      vault_folder_templates: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_guest_tokens: {
        Row: {
          bound_ip: string | null
          bound_user_agent: string | null
          collaborator_id: string
          created_at: string
          expires_at: string
          id: string
          revoked: boolean
          token: string
          unlock_code: string
          unlock_verified_at: string | null
        }
        Insert: {
          bound_ip?: string | null
          bound_user_agent?: string | null
          collaborator_id: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked?: boolean
          token?: string
          unlock_code: string
          unlock_verified_at?: string | null
        }
        Update: {
          bound_ip?: string | null
          bound_user_agent?: string | null
          collaborator_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked?: boolean
          token?: string
          unlock_code?: string
          unlock_verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_guest_tokens_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "vault_collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_share_links: {
        Row: {
          bound_user_agent: string | null
          created_at: string
          created_by: string
          drive_id: string
          expires_at: string | null
          household_id: string
          id: string
          last_accessed_at: string | null
          link_type: Database["public"]["Enums"]["vault_share_link_type"]
          max_uses: number | null
          name: string | null
          permission: Database["public"]["Enums"]["vault_share_permission"]
          revoked_at: string | null
          scope_type: string
          token: string
          unlock_code: string | null
          use_count: number
        }
        Insert: {
          bound_user_agent?: string | null
          created_at?: string
          created_by: string
          drive_id: string
          expires_at?: string | null
          household_id: string
          id?: string
          last_accessed_at?: string | null
          link_type: Database["public"]["Enums"]["vault_share_link_type"]
          max_uses?: number | null
          name?: string | null
          permission?: Database["public"]["Enums"]["vault_share_permission"]
          revoked_at?: string | null
          scope_type: string
          token?: string
          unlock_code?: string | null
          use_count?: number
        }
        Update: {
          bound_user_agent?: string | null
          created_at?: string
          created_by?: string
          drive_id?: string
          expires_at?: string | null
          household_id?: string
          id?: string
          last_accessed_at?: string | null
          link_type?: Database["public"]["Enums"]["vault_share_link_type"]
          max_uses?: number | null
          name?: string | null
          permission?: Database["public"]["Enums"]["vault_share_permission"]
          revoked_at?: string | null
          scope_type?: string
          token?: string
          unlock_code?: string | null
          use_count?: number
        }
        Relationships: []
      }
      vineyard_accounts: {
        Row: {
          account_name: string
          account_number: string | null
          account_type: string
          beneficiary_designation: string | null
          book_value: number | null
          contact_id: string
          created_at: string
          current_value: number | null
          custodian: string | null
          id: string
          notes: string | null
          updated_at: string
          visibility_scope: Database["public"]["Enums"]["visibility_scope"]
        }
        Insert: {
          account_name: string
          account_number?: string | null
          account_type?: string
          beneficiary_designation?: string | null
          book_value?: number | null
          contact_id: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Update: {
          account_name?: string
          account_number?: string | null
          account_type?: string
          beneficiary_designation?: string | null
          book_value?: number | null
          contact_id?: string
          created_at?: string
          current_value?: number | null
          custodian?: string | null
          id?: string
          notes?: string | null
          updated_at?: string
          visibility_scope?: Database["public"]["Enums"]["visibility_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "vineyard_accounts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      waterfall_priorities: {
        Row: {
          created_at: string
          family_id: string
          id: string
          is_active: boolean
          priority_description: string | null
          priority_label: string
          priority_order: number
          target_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          is_active?: boolean
          priority_description?: string | null
          priority_label: string
          priority_order: number
          target_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          is_active?: boolean
          priority_description?: string | null
          priority_label?: string
          priority_order?: number
          target_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waterfall_priorities_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dearmor: { Args: { "": string }; Returns: string }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      match_brain_chunks: {
        Args: {
          filter_doc_types?: string[]
          filter_entity_id?: string
          filter_entity_type?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          doc_type: string
          document_id: string
          heading: string
          occurred_at: string
          similarity: number
          source_system: string
          source_url: string
          title: string
        }[]
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
    }
    Enums: {
      charter_alignment: "aligned" | "misaligned" | "pending_review"
      content_platform: "linkedin" | "substack" | "wix_blog"
      content_status: "draft" | "review" | "approved" | "published" | "archived"
      corporation_type: "opco" | "holdco" | "trust" | "partnership" | "other"
      family_role:
        | "head_of_family"
        | "spouse"
        | "beneficiary"
        | "minor"
        | "head_of_household"
      fee_tier: "sovereign" | "legacy" | "dynasty"
      fiduciary_entity: "pws" | "pwa"
      governance_status: "stabilization" | "sovereign" | "none" | "core"
      liability_counterparty_type: "external" | "corporation" | "contact"
      liability_holder_type: "contact" | "corporation"
      liability_type:
        | "mortgage"
        | "personal_loan"
        | "line_of_credit"
        | "credit_card"
        | "intercompany_loan"
        | "shareholder_loan"
        | "other_debt"
      manual_activity_direction: "inbound" | "outbound"
      manual_activity_kind: "call" | "sms"
      pipeline_category: "pws_consulting" | "new_aum" | "insurance"
      pipeline_status: "pending" | "in_process" | "completed"
      review_status: "pending" | "approved" | "rejected" | "escalated"
      service_tier:
        | "tier_0"
        | "tier_1"
        | "tier_2a"
        | "tier_2b"
        | "tier_3"
        | "tier_4"
      vault_contact_role: "viewer" | "contributor" | "manager"
      vault_share_link_type: "portal" | "guest"
      vault_share_permission: "view" | "view_upload" | "view_upload_download"
      visibility_scope: "private" | "household_shared" | "family_shared"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      charter_alignment: ["aligned", "misaligned", "pending_review"],
      content_platform: ["linkedin", "substack", "wix_blog"],
      content_status: ["draft", "review", "approved", "published", "archived"],
      corporation_type: ["opco", "holdco", "trust", "partnership", "other"],
      family_role: [
        "head_of_family",
        "spouse",
        "beneficiary",
        "minor",
        "head_of_household",
      ],
      fee_tier: ["sovereign", "legacy", "dynasty"],
      fiduciary_entity: ["pws", "pwa"],
      governance_status: ["stabilization", "sovereign", "none", "core"],
      liability_counterparty_type: ["external", "corporation", "contact"],
      liability_holder_type: ["contact", "corporation"],
      liability_type: [
        "mortgage",
        "personal_loan",
        "line_of_credit",
        "credit_card",
        "intercompany_loan",
        "shareholder_loan",
        "other_debt",
      ],
      manual_activity_direction: ["inbound", "outbound"],
      manual_activity_kind: ["call", "sms"],
      pipeline_category: ["pws_consulting", "new_aum", "insurance"],
      pipeline_status: ["pending", "in_process", "completed"],
      review_status: ["pending", "approved", "rejected", "escalated"],
      service_tier: [
        "tier_0",
        "tier_1",
        "tier_2a",
        "tier_2b",
        "tier_3",
        "tier_4",
      ],
      vault_contact_role: ["viewer", "contributor", "manager"],
      vault_share_link_type: ["portal", "guest"],
      vault_share_permission: ["view", "view_upload", "view_upload_download"],
      visibility_scope: ["private", "household_shared", "family_shared"],
    },
  },
} as const
