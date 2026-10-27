// src/components/RecursiveMenuItem.js
"use client";
import React, { useEffect, useState } from "react";
import { Menu as SemanticMenu } from "semantic-ui-react";
import Link from "next/link";
import HoverableDropdown from "@/components/HoverableDropdown";
import { getAccessToken } from "#utils/hydra";
import { fetchContent } from '#utils/api';
import extractEndpoints from '#utils/extractEndpoints';

const RecursiveMenuItem = ({ item }) => {
  const [subItems, setSubItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getSubItems(token = null) {
      if (item["@type"] === "Document") {
        try {
          const apiPath = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
          const content = await fetchContent(apiPath, {
            token: token,
            path: extractEndpoints(item["@id"]),
          });
          setSubItems(content.items || []);
        } catch (error) {
          console.error(error);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    }
    getSubItems(getAccessToken());
  }, [item]);

  if (loading) {
    return null;
  }
  const absoluteUrl = `${(new URL(window.location.href)).origin}/${extractEndpoints(item["@id"])}`;
  return subItems.length > 0 ? (
    <HoverableDropdown item={item} subItems={subItems} />
  ) : (
    <SemanticMenu.Item as={Link} href={absoluteUrl}>
      {item.title}
    </SemanticMenu.Item>
  );
};

export default RecursiveMenuItem;
