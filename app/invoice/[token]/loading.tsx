import { Box, Container, Flex, Spinner } from "@/components/ui";

export default function InvoiceLoading() {
  return (
    <Box style={{ minHeight: "100vh", background: "var(--gray-2)" }}>
      <Container size="1" p={{ initial: "4", sm: "6" }}>
        <Flex align="center" justify="center" minHeight="200px">
          <Spinner size="3" />
        </Flex>
      </Container>
    </Box>
  );
}
