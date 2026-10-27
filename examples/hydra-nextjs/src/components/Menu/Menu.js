"use client";
import React, { useEffect, useState } from "react";
import { Menu as SemanticMenu } from "semantic-ui-react";
import { getAccessToken } from "#utils/hydra";
import Link from "next/link";
import RecursiveMenuItem from "@/components/RecursiveMenuItem";
import { fetchContent } from '#utils/api';

const Menu = () => {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getData(token = null) {
      try {
        const apiPath = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;
        const content = await fetchContent(apiPath, { token });
        setMenuItems(content?.items || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    getData(getAccessToken());
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <SemanticMenu>
      <SemanticMenu.Item>
        <Link href="/">Home</Link>
      </SemanticMenu.Item>
      {menuItems.map(
        (item, index) =>
          item["@type"] === "Document" && (
            <RecursiveMenuItem key={index} item={item} />
          )
      )}
    </SemanticMenu>
  );
};

export default Menu;
